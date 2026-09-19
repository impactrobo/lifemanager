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

- **NetNavi / PET companions — discussed 2026-09-15, nothing built.** (The weekly review it would speak on shipped 2026-09-16; its templates are the seam.) The app is already called
  LIFEMan.EXE, which is a Mega Man Battle Network reference, and that is where the idea came from.
  - **The source material is a real spec, not a sketch.** A "PET Device — Transfer Package" artifact
    holds six fully-written Navis, each with identity, backstory, appearance, personality,
    nicknames, favourites, relationships with the other five, domains of expertise, and a hex colour
    signature: <https://claude.ai/code/artifact/f9a2805a-4df9-407f-8286-a14c50c0f746>
    - Crucially the personalities include **formatting contracts**, not just flavour. StrikeMan's
      reads: `bro` always and only, `##` headers for hype moments, multiple exclamation points on
      high-energy lines, normal prose otherwise. That is implementable with no model involved.
  - **The roster already maps onto `HOME_SECTION_META`** — six Navis, six sections. That mapping is
    the integration seam and it exists already:

    | Navi | Colour | Domain | Section |
    |---|---|---|---|
    | StrikeMan | `#1D9E75` | Fitness & Social | `train` — WELLNESS |
    | Vitalya | `#C2185B` | nutrition, mobility | `health` — DIET / Labs |
    | Wenceslas | `#7F77DD` | money, non-judgmental | `budget` — FINANCIAL |
    | Muze | `#CA6A00` | creative | `hobbies` — Skills |
    | DigiMan | `#378ADD` | tech / systems | `schedule`, sync, data |
    | ClayMan | `#8B0000` | workouts, *real talk* | the hard-truths counterpart |

    The written relationships even encode app behaviour: *"his neglect of mobility work gets him in
    trouble with Vitalya"* is a cross-section interaction between the workout planner and Labs.
  - **A colour collision to decide before building.** Sections own identity colours already
    (`train` is `#FF9191`) and link chips derive from them — `test_home_bar.js` asserts a meal chip
    and a workout chip stay visually distinct. A Navi's colour therefore cannot simply override its
    section's. Either the Navi colour is used only for *the Navi* (portrait, name, speech), or the
    sections get recoloured to the roster and that test moves with them.
  - **Where a Navi should actually speak** — not everywhere, which is how this would get annoying
    fast:
    - **The weekly review** (still the top unbuilt item). Its premise is *process* metrics reflected
      back, and a Navi delivering your week beats a table of counts. Needs no model.
    - **Streak and PR moments** — StrikeMan's stated job is consistency, and the app already knows
      when a streak lands or a PR is set.
    - **"Bad-day" mode** — ClayMan is written for precisely this, and it is already a scoped
      backlog item under the Best Shape list.
  - **THE LINE THIS HAS TO HOLD, and it is the important part.** This list already rules out
    "points, badges, streak-shaming — the app instruments the plan and doesn't second-guess the
    person, and gamification would be a different product." A cheering companion sits close to that
    line. The roster mostly resolves it on its own (StrikeMan is *"honest when honesty is needed…
    from a place of total belief"*; Wenceslas *"understands without judgment"*), but state it as a
    rule rather than discover it later:
    > **A Navi reacts to what you did. It never asks you to do it for the Navi.** Instrumentation
    > with a voice, not a pet to keep alive.
  - **Templates first, Claude second — and not only because of the `window.claude` problem.** A
    template layer forces the voice rules to be explicit and testable, which makes swapping in a
    model later a *content* change rather than an architecture one. Built prompt-first, the
    personalities bake into strings that can't be tested offline. (The hosting constraint is real
    too — see the Claude-assisted lab entry entry below for why a Worker proxy is the only route.)

- **LEFTY / RIGHTY: only the header moves so far (2026-09-19).** Asked for with *"make a note to
  build more on this later"*, so this is that note. Settings → HANDED swaps the header's two button
  groups (Back/Forward ↔ Home/Settings). Both were already absolutely positioned against opposite
  edges, so the flip is two CSS declarations off a `data-handed` attribute on `<body>`; the default
  is right-handed and unstamped, so nobody who never opens the setting sees a change.
  - What a fuller version would reach, roughly in order of how much it would actually help:
    - **Sheets and modals** — the phase editor's close X, the Convert sheet, the rest picker. These
      are the next most thumb-hostile controls after the header.
    - **Row-level actions** — the pencil and delete on income sources, charges, goals, notes. They
      sit hard right on every card in the app.
    - **The FAB** (Notes' new-note button), which is bottom-right by convention.
    - **Swipe directions**, if any are ever added back — a left-handed swipe-to-delete wants the
      opposite origin.
  - Deliberately NOT: the bottom bar (reachable with either thumb) or chart axes and reading order
    (handedness is about reach, not about which way you read).
  - The honest open question is whether this is worth carrying at all versus one global mirror, and
    the only way to answer it is to live with the header version for a while first.

- **~~Health & Wellness's bottom tabbar overruns on a real device~~ — RESOLVED, see Recently
  Shipped (2026-09-17/19).** Kept as a record of how it was closed, because the measurement habit it
  forced is the useful part. The bar went WORKOUTS/GOAL/BODY/DIET/LONGEVITY/SETUP + HOME (seven) →
  four (DAILY/PHASES/BUILDER/PROGRESS), and Home's bar is now the five sections. Both are
  *measured* rather than assumed: five section labels clip below 390px, which is why PRODUCTIVITY
  reads PROD. The original analysis below still describes the mechanism accurately, and the
  scroll-chevron affordance it proposed was never needed once the button count came down.
  - `.tabbar` (`styles.css`) already has `overflow-x:auto` and `min-width:58px` per button — a
    comment on it even predicts this exact case ("once a section has enough sub-tabs to exceed the
    viewport (e.g. Health & Diet's 7)"). But unlike `.subnav` (the in-screen sub-tab strips), it has
    **no scroll-chevron affordance** (`subnav-more-l`/`-r`) — nothing tells you there's more to the
    right. At a real device's system font size (Dynamic Type), `.tabbar button` labels use
    `white-space: nowrap` with no truncation, which could let a long label bleed past its own 58px
    box into its neighbour rather than wrapping or clipping.
  - Likely fix shape: give `.tabbar` the same chevron-affordance system `.subnav` already has (see
    `subnav-scroll-affordances` in project memory), and/or clip/ellipsis long labels. Worth checking
    on the real device first — six buttons may already fit, and the fix (if still needed) is small
    either way.


- ~~`test_day_fold.js` fails when run within a few minutes of midnight~~ — **fixed the same day**,
  see Recently Shipped.

- **Claude-assisted lab entry, if the paste-parser proves insufficient (2026-09-15).** The parser
  now shipping reads pasted *text*. It cannot read a photo of a printout or a PDF, and it will miss
  formats nobody anticipated. A model would handle both. Deliberately deferred until the parser has
  actually been used enough to say what it misses — and the bar is high, for two reasons worth
  keeping written down:
  - **Lab results are the most sensitive data in this app.** Everything else here is local-first by
    construction; sending a report to an API is a genuine departure, not an implementation detail,
    and is the person's call to make explicitly rather than a feature that quietly appears.
  - **There is no free way to make the call.** `window.claude` exists only inside Claude artifacts,
    *not* on GitHub Pages where this app actually runs — the same lesson `exportData()` taught (see
    CLAUDE.md). So it needs either the existing Cloudflare Worker extended into a key-holding proxy,
    or a user-supplied key. **Not the latter:** a key in `localStorage` rides into Firestore with
    Cloud Sync, which is a credential leak, not a setting.
  - If it is built: it should fill the same draft the parser fills and go through the same
    check-before-save review, so the trust model doesn't change with the input method.

- **"Best Shape of Your Life" scope check (2026-09-14)** — for someone overweight, untrained,
  motivation-sensitive, with a longevity focus (biomarkers, supplementation) across health, money
  and personal development. Full scope published as an artifact; ranked by leverage, not size:
  1. ~~**Weekly review**~~ — **shipped 2026-09-16** (see Recently Shipped): workouts done vs
     planned, habits kept, target days hit, PRs, weight as a rate, practice — plus a deliberate
     off-week mark. Still the surface most of the items below would land on. **Not built:** a Navi
     delivering it (see the NetNavi entry — templates first, deliberately), and nothing yet links
     the review to the bad-day mode in item 6.
  2. ~~**Chart sleep & steps, add RHR/BP chips**~~ — **fully shipped 2026-09-15**: sleep hours,
     sleep quality, steps, resting heart rate and blood pressure (see Recently Shipped). BP was
     briefly held back as not fitting a single-value chart, then built once the water chip's
     existing a/b display (`1250/2000`) was pointed out as the precedent it needed.
  3. ~~**Lab biomarkers**~~ — **shipped 2026-09-15**: 32 markers, two ranges, the position bar, and
     pasting a report to fill the form (see Recently Shipped). A time-series chart with the same
     bands behind it is the remaining tail, and needs several draws before it says anything.
  4. ~~**Editable, dosed supplement stack + adherence**~~ — **shipped 2026-09-15** as part of
     dissolving Longevity (see Recently Shipped): editable regimen, real stacks, per-day adherence,
     the old 7 as an installable preset. **Not built:** linking a supplement to the lab marker it's
     meant to move or the budget line it costs — that cross-linking was never scoped, only the
     regimen itself was.
  5. **Cost of the meal plan vs the Groceries budget** (M) — where money and health meet; optional
     price on foods, same shape as nutrition.
  6. **Beginner on-ramp template** (S–M) — a shipped first-block template (walking + 2 full-body
     sessions + mobility) the way C25K already proves works for cardio. **The "bad-day mode" half
     shipped 2026-09-16** as modded sessions (see Recently Shipped), and turned out to need no new
     progression machinery at all — only a label and a way to fold a long session down.
  7. ~~**Skills, generalised**~~ — scoped as "Skills Own the Ladder", **all 6 steps shipped
     2026-09-15**, plus the four-step "Closing the Loop" punch list between 2 and 3 (see Recently
     Shipped). One optional tail remains: `exercisePlan` is now a misnomer, since it holds practice
     entries too. The UI already says "Planner" rather than "Exercise plan", so the leak is internal
     — whether it's worth a second migration to rename is a judgment call, not a defect.
  Deliberately **not** proposed: points, badges, streak-shaming — the app instruments the plan and
  doesn't second-guess the person, and gamification would be a different product.

- ~~Home becomes the calendar's own Day view~~ — **shipped 2026-09-13** as "Home Becomes Today",
  see Recently Shipped. The version that actually got built dropped the customisation question
  this entry raised rather than answering it: Home's day content (RIGHT NOW/WORKOUTS/HABITS) is no
  longer independently rearrangeable, on the view that a fixed daily rhythm needs less tinkering
  than six independent sections did. The section tile grid stayed drag/hide-able.

- **Scheduling build-out — agreed 2026-09-12, step 1 of 4 shipped.** Came from a review of what
  this app's scheduling lacked next to general calendar apps. The person picked four areas and
  approved this dependency order; steps 2-4 are **agreed work, not speculative ideas**, but still
  confirm before starting each:
  1. ~~Dated one-off events (Reminders gain an optional end time) + a Day timeline showing
     duration~~ — **shipped 2026-09-12**, see Recently Shipped.
  2. ~~**Calendar as the true union of the app.**~~ — **shipped 2026-09-12** for planned workouts,
     planned meals and habits; see Recently Shipped. **Budget charge due dates were deliberately
     left out — **shipped 2026-09-13**, see Recently Shipped. Built beyond the original minimal
     scoping: not just the calendar marker, but an opt-in push reminder and a general lead-time
     field any reminder can use.
  3. **Recurrence + single-day exceptions — split in two, first half shipped.** Scoped into two
     unrelated pieces before building, since they touch different parts of the data model:
     - ~~Recurring reminders (annual + monthly)~~ — **shipped 2026-09-12**, see Recently Shipped.
     - ~~Schedule exceptions (date-range overrides)~~ — **shipped 2026-09-12**, see Recently
       Shipped. Built fuller than the original minimal scoping: date *ranges* rather than single
       days, creation on the Day view **and** a review list in Setup, a per-exception anchors
       choice, and a day off pausing planned workouts/meals/habits too. (Habits were carved back
       out of that pause on 2026-09-13 when the day model landed — see Recently Shipped.)
     Every-other-week/every-N-days recurrence and `periodic` anchors landing on actual calendar
     dates (they're currently a cadence-days due-list that never does) were both considered and
     deliberately left out of the recurring-reminders half — annual + monthly were judged the
     patterns actually worth building now.
  4. Smaller items surfaced by the same review:
     - ~~Overlap detection between the things in a day~~ — **shipped 2026-09-13**, see Recently
       Shipped.
     - ~~Forward-looking agenda~~ — **shipped 2026-09-13**, see Recently Shipped.
     - ~~Time-budget rollup~~ — **shipped 2026-09-13**, see Recently Shipped.
  Explicitly ruled out as groupware that doesn't apply to a single-user local-first app: invites,
  attendees, free/busy sharing, calendar subscriptions.
- **Cross-feature linking — a general mechanism now exists (see the link primitive under Recently
  Shipped, 2026-09-13), so the remaining candidates are instances of it rather than new features.**
  Original note follows. **Cross-feature linking, other candidates surfaced 2026-09-12** (four of the batch already
  shipped, most recently Note -> Reminder — see Recently Shipped): a Calendar marker on a
  recurring budget charge's due date (same spirit as the schedule anchor icon); tagging a Note to
  the specific workout/exercise day it's about, rather than just a freeform date. (A noticeable
  moment when a Savings Goal completes was floated too, but explicitly deferred — the person wants
  it to feel custom per aesthetic rather than one generic animation, which is real design work of
  its own.)
- ~~**Exercise:** a personal-record (PR) log/timeline~~ — **shipped 2026-09-14** as part of
  "Phases Own the Plan" step 8, see Recently Shipped. `bestForLift()` backs both it and exercise
  targets, so the two can never disagree about what your best is.
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

- **FINANCIAL gets sub-navs, like the WELLNESS screens (2026-09-19).** Asked for as *"start making
  tabs in the FINANCIAL sections… Goal is to have as much as possible in one screen."*
  - **RECURRING** is `INCOME / CHARGES / SAVE & INVEST` instead of four stacked sections, which was
    a long scroll of things you weren't looking at.
  - **The three totals sit ABOVE the strip and are always all three.** That is what makes tabbing
    cost nothing: you can still read what every section holds without visiting it, so the strip only
    decides what you EDIT. They also replaced the explanatory paragraph that used to sit there, and
    each is a shortcut to its own tab.
  - The savings planning calculator stays WITH the savings lines rather than floating above all
    three tabs — it is a target for that section and reads as one there.
  - **OVERVIEW** is `INCIDENTALS / SAVINGS / GOALS`. The bar does NOT move into a tab: it is the
    answer the screen exists to give. GOALS renders the same cards as the GOALS subtab minus ADD
    GOAL, so a goal can be funded without leaving the month you are looking at.
  - **One real bug came with it, caught by a test rather than by review:** opening a charge from a
    link chip landed on RECURRING but not on the charge, because a savings line lives under SAVE &
    INVEST and a bill under CHARGES. `test_navigate_to.js` asserts the ENTITY is on screen rather
    than just the section, which is the only reason it surfaced.

- **The money screens learn one editing grammar (2026-09-18 → 19).** Six passes over two days, all
  converging on the same shape: **a button at rest, a form on request, a readout by default, and
  editing behind a pencil.**
  - **One container per subject.** INCIDENTALS holds its add buttons AND its entries; INCOME
    SOURCES, RECURRING CHARGES and RECURRING SAVINGS each hold their adder and their list. They used
    to be an ADD panel and a separate list with a heading between them, which split one subject
    across two headings.
  - **Rows are readouts; the pencil is the way in.** Income sources and recurring charges were walls
    of live inputs — an accidental edit to a number the budget bar computes from, and a row that
    read as unfinished rather than as data. **ACTIVE stays a live checkbox in both modes**, because
    turning a line off for a month is the frequent, instantly-reversible act; putting it behind the
    pencil would cost two taps to save nothing.
  - **Two dropdowns, not one merged list.** INCOME and CHARGES each sit behind their own caret using
    `.disclose-row`, with the total on the closed header — the shape exists so you read the answer
    without opening anything. A merged list put money in and money out in one column and asked you
    to notice a `+`.
  - **Savings stops pretending to be a charge.** Recurring savings moved out of RECURRING CHARGES
    into their own section, then to the bottom of the screen, so it reads in the order the money
    moves: what comes in, what has to go out, what is left going to you. Their add form drops the
    "Savings / Investment" checkbox (you answered that by adding it there) and narrows its
    categories to Savings / Investing. A savings ROW keeps an escape hatch — **MOVE TO RECURRING
    CHARGES**, which says where it goes rather than asking what it is.
  - **Every writer returns whether it saved**, so a bad amount leaves the form open with what was
    typed still in it rather than closing and losing it.
  - `YEARLY` added to the recurring frequencies. An annual bonus previously had to be divided by
    twelve by hand and called monthly.
  - Goals got the same pencil and DONE, and **expanding a goal and editing it became two states** —
    what it HOLDS versus what it IS. Delete moved into edit mode with it: a red X beside a row you
    are only reading is a mis-tap waiting to happen, and it sat exactly where the pencil now is.

- **The bottom bar becomes the sections, and Home stops being a waypoint (2026-09-18 → 19).**
  - Home's bar being EMPTY was the tell that the app had no tab bar at all: the strip held the
    current section's SUBTABS, so crossing sections cost a trip Home — wordmark, then a tile. The
    five sections live on Home's bar now, in the order asked for, each carrying its own identity
    colour as a bar along its top edge. Inside a section the bar is still that section's subtabs,
    unchanged.
  - `PRODUCTIVITY` truncates to `PROD`. Measured: five full labels clip below 390px; the shipped set
    fits at 360 and 390 and clips 3px at 320.
  - **The section tile row left Home's reading view** — the bar says the same five things, so the
    row said everything twice and pushed the day below the fold. The tiles survive in EDIT mode,
    where they still do a job the bar cannot: their order and hidden set are what every
    `HOME_SECTION_META` consumer reads.
  - **Reaching the sections from inside one was a SWIPE UP for a day, and it was wrong twice over.**
    An upward drag on a bottom strip is also how you scroll and how iOS reaches its own app
    switcher, so it fired by accident going in and out of the app and never felt reliable when you
    did mean it. One gesture now — **hold** — on either kind of bar: on Home it offers that
    section's subtabs, anywhere else it offers Home and the five sections.
  - **Home moved off the wordmark to a house button** beside the gear. A logo that navigates is a
    secret button: nothing about a title says "press me", and it is easy to hit while reading.
  - Two device-reported bar fixes: it **grew 4px leaving Home** (the swipe grip added padding only
    where the grip existed — a strip that changes height under your thumb as you navigate), and
    **holding a button selected its label** and left the selection stuck to your finger.
  - `tests/test_section_nav.js` now pins that a swipe does **nothing** — the regression worth
    guarding, because reinstating the gesture would be an easy "improvement" to make by mistake.

- **Back returns to the last PLACE, not the last SECTION (2026-09-18).** Reported as *"I normally
  want to go back to another SubNav within the section, hit the back arrow, then fly back to the
  Home Screen."*
  - `pushNavHistory()` was called by hand from `switchTab()` and two openers and nowhere else, so
    subtab moves left no trace: DAILY → PHASES → BUILDER then Back threw you out of the section,
    skipping all three moves you actually made.
  - Fixed by **deriving** history rather than pushing it: `_trackNavHistory()` runs once per render
    and records any change to the nav snapshot, whoever caused it — instead of adding a push to
    eleven subtab setters, which is the list-in-two-places problem this codebase keeps designing out
    and would have missed the twelfth.
  - **The deferral that introduces is a feature.** Several NAV keys changing in one tick is ONE
    navigation and should be ONE Back step, which is exactly what `goToSection()` does.
  - Open question, raised and not acted on: **FORWARD probably should go.** Native apps have a
    contextual back inside a navigation stack, not a global browser-style pair, and almost none have
    a forward. Back is worth keeping now that it records the moves you actually make.

- **An overlay keeps its scroll position across a re-render (2026-09-18).** Reported as *"even on a
  fresh open, navigating into PHASES and editing or making NEW still has strange scroll issues."*
  - Every control in the phase editor commits on change, so every change re-renders — and a render
    rebuilds the overlay from markup, giving it a brand-new scroll container starting at 0. Scroll
    down to a field, change it, and you are thrown back to the top. Measured: `scrollTop 118 → 0` on
    a single field change.
  - The same problem `_captureSubnavScroll()` already solved for the sub-nav strips, one layer up,
    so it got the same treatment. Keyed by class name; the memory clears the moment no overlay is
    open, so opening a different phase starts at the top rather than inheriting the last one's
    offset.
  - Also `overscroll-behavior: contain` on the scrollable overlay regions. Without it a flick that
    reaches the end of a full-screen sheet chains into the page behind it — the other half of
    "strange scroll issues", and the half a desktop browser never shows you.

- **PHASES becomes SCHEDULE / COMPOSE / ARCHIVED (2026-09-18).** Asked for as *"NEW goes to
  SCHEDULE, then both WORKOUT PLAN and MEAL PLAN should be sub nav chips under a new tab: COMPOSE…
  you must first select a given PHASE, then the WORKOUT PLAN and MEAL PLAN chips light up (from
  grey)."*
  - **It fixes a real defect, not just the layout.** WORKOUT PLAN and MEAL PLAN were peers at the
    subtab level, and each carried its OWN "Adding to which phase" dropdown backed by its own state
    (`VIEW.plannerDate` / `VIEW.mealPlannerDate`). Two independent answers to one question: you
    could be laying out Phase 2's workouts and Phase 3's meals at the same time with nothing on
    screen saying so. COMPOSE asks once and drives both.
  - The picker is **tappable phase cards** (the user's pick over a dropdown), folding to a one-line
    summary once chosen. The two plan chips do not exist until a phase is picked: they were greyed
    and disabled at first, and that was one revision too clever — the line above the list already
    says the plans open once you choose, so two dead buttons under it were just furniture. Nothing
    on the picker screen is present-but-unusable, which is what the test now pins.
  - Each chip renders its **existing workflow unchanged**, via a new `opts.scope === false` that
    drops the now-redundant per-tab dropdown. `renderPlannerScope()` / `renderMealPlannerScope()`
    still exist and still work; nothing in the UI passes `scope: true` any more, and
    `test_exercise_goals.js` is currently their only caller.
  - **Key stays `'goal'` for SCHEDULE** — it rides in saved nav snapshots, and renaming it would
    land old ones on the fallback. `'workouts'` and `'meals'` alias to COMPOSE *with the chip they
    meant already chosen*, so an old deep link reaches what it pointed at.
  - The shelf is **named rather than silently omitted**: a shelved phase has no dates, and a plan is
    resolved by the day it is in force on, so there is no week to plan onto yet.
  - `tests/test_compose.js`; three mutations verified to fail, including the one that matters most —
    pointing only the workout planner at the selection, which is the old split restored. A CSS trap
    was caught on the way: `.phase-state-*` sets only `border-left-color`, so `.compose-selected`'s
    `border-left` shorthand declared further down the file silently beat it and the summary lost its
    state colour. The rule moved above them; the test now asserts the computed colour.
  - Six tests needed their premises restated. Four just needed a phase picked first. Two were real:
    `test_exercise_goals.js` read the phase editor's text out of `#app`, which is no longer where
    the modal lives, and `test_ui_polish.js` tested sub-nav scroll affordances against *"PHASES'
    four tabs overflow a 390px phone"* — three tabs don't. It now uses PROGRESS' five at 360px, and
    asserts the overflow precondition rather than assuming it.

- **A left-open phase editor no longer follows you back to PHASES (2026-09-18).** Reported as
  *"going into PHASES from outside, you can't scroll the screen until you tap a text box or input…
  focus issue?"* — not a focus issue. Nothing was wrong with the scroll: the phase editor was still
  open, and returning to PHASES re-rendered it as a full-viewport sheet that swallowed every touch.
  - **`phaseOpen` was in the wrong state object.** The app keeps three: `NAV` (where am I), `UI`
    (what's open right now, wiped on navigation) and `VIEW` (per-screen presentation, which
    deliberately survives navigation so a half-built meal or a draft is still there when you come
    back). `phaseOpen` sat in `VIEW`, commented as *"which phase card is expanded"* — true when the
    editor was an inline disclosure. It became a modal and nothing moved it. An open modal is
    textbook `UI`; there it closes on every navigation by construction.
  - **The hoist made a pre-existing bug catastrophic.** The same stale modal has been re-rendering
    on return for as long as the editor has been a modal — it was simply buried under the bars
    before, so it looked like clutter rather than a dead screen.
  - **Second gap, independent of the first:** `setFitnessSubtab()` never called `resetTransientUi()`,
    so BUILDER → PHASES leaked the editor even once `phaseOpen` moved. Moving between subtabs *is*
    navigation — DAILY / PHASES / BUILDER / PROGRESS are four screens. Train is the only section
    whose subtabs host a modal, so the reset went there rather than into every setter on spec.
  - The new check in `tests/test_overlay_layering.js` asserts the **property, not the field**: open
    an overlay, leave, come back, and nothing is floating over the screen — via another section, via
    another subtab, and via Back. The two mutations fail on *different* legs of that, which is what
    confirmed the two gaps were genuinely independent rather than one bug seen twice.

- **Reading a note is no longer one tap from editing it (2026-09-18).** Reported: *"tapping to say
  check off a TODO box then immediately enters edit mode instead of simply ticking the box. Let's
  have neither the title nor text tap immediately go to edit. Add a specific pencil icon above on
  the top-right."*
  - The cause was a click handler on the whole body — `.entry-view` carried
    `onclick="setEntryMode('edit')"`. Tapping a checklist box ran the box's own handler AND then
    bubbled to the body's, so it ticked *and* opened the editor. The tick looked swallowed because
    the re-render dropped you into a textarea showing raw `- [x]` markdown.
  - Edit is now a **mode entered from one button**: a pencil at the top right, with the date pushed
    left of it, which becomes a lit tick while editing. The read view is not a click target at all,
    and the title renders as a heading rather than a focusable field.
  - **SAVE is edit-only.** In read mode there is nothing uncommitted — ticking a box writes through
    immediately — so a SAVE button there offered to do nothing while implying that skipping it might
    lose something.
  - The landing note still opens straight into **edit** mode. Read-mode-by-default would have put an
    empty page behind a button press, which is the exact friction landing on a new note removes.
  - `tests/test_note_read_mode.js`. Four mutations verified to fail, including restoring the
    original `onclick`, which reproduces the report exactly: mode flips to `edit` and the checkboxes
    vanish from the DOM. Checked with the static assertion disabled too, so the behavioural check
    stands on its own rather than being carried by the easy one.

- **Two field bugs: a modal under the header, and a search box that dropped focus (2026-09-18).**
  Both reported from a phone, and both turned out to be a whole class rather than one screen.
  - **The Phase editor opened UNDER the top bar** — its title input invisible and untappable (taps
    landed on the wordmark), its DONE button under the tab bar. The cause is a two-part trap that
    looks wrong in neither half: all eleven themed aesthetics set `#app { position: relative;
    z-index: 1 }` so their own backdrop pseudo-elements (bubbles, a spinning ring, doorways) layer
    behind the content — entirely reasonable — and that makes `#app` a **stacking context**, which
    is a ceiling. Nothing inside it can paint above a SIBLING of `#app`, whatever z-index it asks
    for, and `.topbar` (20) and `.tabbar` (30) are exactly such siblings. So `.modal-overlay`
    asking for 100 lost to a bar at 20.
  - **Thirteen overlays were rendered that way.** The Phase editor was simply the first that was
    full-height with a control in the top 52px, which is why it was the one that got noticed. (The
    Cloud Sync modal's `padding-top: 48px` looks a lot like someone working around this once.)
  - The fix: `_hoistOverlays()` moves them to **`#overlayRoot`**, a plain child of `<body>` — which
    is where every overlay declared in index.html already lived, and exactly why `#confirmOverlay`
    and `#imageLightboxOverlay` never had the problem. Raising `#app` would put the bars under page
    content; lowering the bars is what CLAUDE.md says in as many words not to do.
  - The tidier rule — "a screen renders one `.screen`, so anything else at `#app`'s top level is an
    overlay" — was tried first and is **false of the reported case**: the Phase editor is emitted
    from inside a tab's markup, several levels down. Depth isn't the signal; being a full-viewport
    fixed layer is.
  - **Every letter typed into the Training Maxes lift search dropped focus**, so each one needed a
    fresh tap on the field. `setLiftMaxQuery()` called `render()`, which replaces `#app.innerHTML`
    and destroys the input being typed into. The app had already solved this four times — and
    `setLiftPickerQuery()` had the same bug, unreported. Both now patch a results container by id.
  - `tests/test_overlay_layering.js` derives the overlay set from styles.css rather than restating
    it, and checks the Phase editor's title is genuinely hit-testable **in all 23 aesthetics**.
    `tests/test_search_focus.js` pins the RULE — no `oninput` handler anywhere may call `render()` —
    which is the only form a seventh search box can't slip past. Three mutations verified to fail.
    One handler is allowed to contain `render()`: `saveLogField(field, value, quiet)` renders only
    when `quiet` is falsy, and the check verifies the `true` at the call site rather than
    exempting the name.

- **Training Maxes can be grouped and filtered (2026-09-18).** Asked for as *"ensure we can filter
  by muscle... we have UPPER / LOWER / CORE for some, but also can set PUSH / PULL / LEGS / OTHER
  definitions for filtering as well. This can be a setting under rounding for how to sort"*.
  - **PUSH / PULL / LEGS is DERIVED from the muscle**, exactly as UPPER / LOWER / CORE already was,
    rather than stored beside it. Nothing is classified twice and the two can never disagree. The
    conventional reading: side delts press, rear delts row, the deadlift rides with Back onto pull,
    and a close-grip bench is a Triceps lift so it lands on push.
  - Abs and Neck are `'other'` **explicitly** — a real answer, the same judgement that gave Abs its
    own `'core'`. A muscle the table has never heard of returns `null` and lands in its own trailing
    UNSORTED group instead, because only one of those two is something you can act on.
  - **One registry, `LIFT_GROUP_DIMS`**, read by the group-by control, the headings and the filter
    chips alike. The filter's options ARE the groups, which is what stops "filter by muscle" and
    "group by push/pull" from becoming two controls that describe the list differently.
  - **The dimension is a `<select>`, not a fourth pill strip.** The first build made it a `subNav`
    and the screenshot settled it: the screen already sits under two identical-looking pill strips,
    and a third that scrolls the list instead of navigating is exactly the complexity this session
    was asked to reduce. A select reads as a control you set, and leaves pills on this screen
    meaning one thing — filter.
  - The dimension is remembered (`STATE.settings.tmGroupBy`); the **filter deliberately is not**,
    the same split Notes draws, for the same reason: arriving at a screen still filtered from last
    week is how a lift goes missing. Changing dimension clears the filter too — a muscle filter
    names no group under push/pull.
  - Chips appear only when the dimension actually splits the list, but the **control never hides**:
    if it vanished whenever the current dimension produced one group, you could switch into that
    dimension and have no way back out.
  - `tests/test_lift_grouping.js`. Its first check is a *completeness* check — a derived
    classification is only as good as its table, and a muscle added to the palette but missed in
    `MUSCLE_PPL` wouldn't error, it would quietly drop its lifts into UNSORTED. Three mutations
    verified to fail it, including the `--tc` cascade trap (a grey `--tc` beats the accent fallback,
    so the *selected* chip renders as unselected — the exact bug styles.css logs against COMPARE).

- **Notes opens on a blank note, and DIET & EXERCISE becomes DAILY (2026-09-18).** Two small
  navigation changes asked for together: *"Notes should always start on NEW (which doesn't light
  up for some reason)"*.
  - **Notes lands on the editor, not the list.** Arriving at the section — by tab, or by booting
    into it from Settings → Default Page — creates a fresh empty entry and opens it in edit mode.
    The list is where you go to FIND something, which is the rarer errand; the section's whole
    premise is that writing something down should cost nothing.
  - **The sweep is what makes that safe.** The app now creates a record nobody asked for on every
    visit, so every way OUT of the editor removes it again when nothing was written: closing the
    entry, tapping VIEW ALL, navigating to another section, following a link out of it, and — the
    one no exit path can cover — killing the app mid-note, swept at the next boot. Miss one and
    the list silently fills with "Untitled" cards, which is worse than the friction removed.
  - `entryIsBlank()` is the single definition of "nothing in it", in `app-entries.js` beside
    `startBlankEntry()` and `purgeEmptyEntries()`. The check it replaced was written inline in
    `closeEntry()` and **had already drifted**: it knew about text, photos, tags and links, but not
    hub members or template fields, so a hub you had added three notes to and then left by the
    back arrow counted as empty.
  - **A blank note is never a Back destination.** `openEntry()` used to push whatever you were
    leaving; following a link out of the landing note would have put a record on the back stack
    that the sweep was about to delete. It pushes only non-blank entries now, and sweeps the rest.
  - **NEW lights up.** It was `active: () => false` on the grounds that it is an action rather than
    a place. That was already thin, and once Notes landed on the editor it left the bar with
    NOTHING lit — the reported bug. An open entry IS where you are. Both Notes rules now ask
    `openEntryRecord()`, the same question `renderNotes()` asks, rather than reading
    `VIEW.entryOpenId`: the id can outlive its entry, and then the bar says "editor" while the
    screen shows the list.
  - **DIET & EXERCISE → DAILY.** The old label named the screen's two subjects, which made it the
    longest button on a four-button bar and forced a `<br>` the other three don't need. It names
    WHEN instead of WHAT — this is the today screen, and its three neighbours are all things you
    set up once and revisit. The two subjects are still named, by the EXERCISE / MEALS strip inside.
  - `tests/test_notes_landing.js` pins all of it; four mutations (NEW never lights, no sweep on
    leaving, no sweep at boot, blank-check before the draft is committed) were each verified to
    fail it. The last of those is a real bug the test found while being written: pressing NEW on a
    half-typed note read the *record* as empty, reused it, and the text went with the re-render.

- **The bottom bar becomes a registry (2026-09-17).** `renderTabbar()` was a ~90-line chain of
  `if (NAV.currentTab === 'x')` with each section's buttons written out by hand, so every
  navigation change meant editing control flow to express what is really a list — three times now.
  Sections are entries in `SECTION_BARS` instead: `{ nav, set, alias, buttons }`, where a button
  is `{ key, icon, label }` and its onclick and active state are generated. Odd shapes stay
  expressible — `active: () => !VIEW.entryOpenId` for Notes (whose "current" lives in VIEW, not a
  NAV subtab), a function-valued `buttons` for Hobbies (one button inside a skill, none outside),
  `cls: 'tabbar-close'` for Settings.
  - **The whole suite passed unchanged**, which is the evidence that mattered: behaviour is
    identical, including all three retired-subtab aliases.
  - `tests/test_tabbar_registry.js` is the new contract, and it exists because a registry only
    pays off if a typo in it fails loudly — a hand-written bar was at least visible, whereas data
    can name a setter, icon or subtab that doesn't exist and render a button that looks fine and
    does nothing. All four of those mutations were verified to fail the test.
  - The sharpest of the four: a mistyped subtab key **still "lands"**, because the setters just
    assign. What actually breaks is downstream, where an unknown subtab falls through to the
    section's default — so the button lights up and shows the first screen's content. Caught by
    asserting every key renders a DISTINCT screen.

- **CALENDAR and SETUP move off Home's bar into a PRODUCTIVITY tile (2026-09-17).** Asked for as
  "keep the HOME page clean". Home's bar carried two buttons for ONE section while every other
  section reached its subtabs from its own tile; `schedule` is a tile again, renamed PRODUCTIVITY,
  and those two are its subtabs like everybody else's. Home's bar is now empty, and **an empty bar
  hides itself** rather than rendering a blank strip — driven by what `renderTabbar()` produced,
  not by naming Home, so a future section with no subtabs behaves the same way for free.
  - Three things had to be un-retired together, and the test suite found each one: `schedule` left
    `RETIRED_SECTION_TILES`, the migration that rewrote a saved `defaultPage` of 'schedule' was
    deleted, and Settings offers it as a landing page again.
  - A **one-time migration** puts the tile back into existing layouts. It has to be named
    explicitly: the retirement had pushed `schedule` into `sectionHidden`, and the generic
    "append anything new" rule skips hidden ids — to that rule it looked like a section you'd chosen
    to hide.
  - Surfaced a real ordering subtlety worth writing down: `NAV.currentTab` is set by
    `initialTab()` during **script evaluation**, before `migrateState()` runs. A migration that
    rewrites `defaultPage` therefore cannot change the tab you boot into on that same launch — only
    the next one. That is why `health` still needs `initialTab()`'s own guard as well.

- **A BODY entry is the day's record, and deleting one deletes the day (2026-09-17).** Closes the
  flag from the field: *"why not allow the user to track it all? Delete everything together and
  maintain the other aspects as part of the tracked items."*
  - **Water and steps join the form.** They were the last two daily readings only reachable from
    Home, which matters because someone whose default screen is EXERCISE never opens Home. Water
    converts both ways — millilitres on disk whatever unit the field shows — because writing back
    whatever was typed would silently reinterpret every stored number the moment you switched to cups.
  - **Delete now takes the whole day**: every daily-log field, the weight row, the measurements, and
    that day's bathroom readings. The old behaviour cleared only the three fields the card showed,
    on the reasoning that deleting what you can see must not quietly take what you can't. The
    reasoning was sound; the premise stopped being true the moment the card started showing water,
    steps and the day's bathroom figures.
  - **Two lists, not one**, and the distinction is now explicit. `BODY_DAILY_FIELDS` is what the form
    edits (five); `BODY_ENTRY_FIELDS` is what makes a day an *entry* (three). Water and steps are
    reachable here without every day you drank water burying the days you actually weighed in. A save
    that produces no card says so rather than looking like a no-op.
  - Caught by the tests: `test_body_edit.js` was **asserting the old behaviour** — that water and
    steps survived a delete — so it was pinning the thing that got reported.
  - Caught by a screenshot: five fields across 390px wrapped their labels to different heights and
    left the inputs at three different baselines. They're a grid now.

- **Stool and urine become tracked measurements (2026-09-17).** Both scales were already logged as
  several timestamped readings a day; what was missing was any way to compare them over time, or to
  reach them from the BODY screen at all.
  - **Two derived numbers per day, not one**: the average of the readings AND how many there were.
    Average Bristol is consistency and average colour is hydration, but the COUNT is frequency —
    and frequency is the number that actually moves when you change fibre. Charting quality without
    quantity answers half the question.
  - **Nothing is stored.** `scaleDayStats()` derives both on read from the same
    `STATE.life.*Log` arrays Home writes, so the Home chips and the BODY screen cannot report
    different numbers for a day. No "bathroom entry" record exists.
  - **Four new metrics** (`stoolAvg`, `stoolCount`, `urineColorAvg`, `urineCount`) on a third
    `source: 'scale'` in `WEIGHT_METRICS`, folded to one point per day by `metricSeries()`. Being in
    that list means they appear in COMPARE's BODY group and the body chart selector for free.
  - **A bathroom sheet on BODY**, behind a toilet button beside the entry button, showing BOTH
    scales at once for one date. It sits beside the form rather than inside it because the two are
    used at different moments — the form is a once-a-morning act, a trip to the loo is three times a
    day. Every tap ADDS a reading rather than correcting the last, which is the opposite of Home's
    one-per-visit rule and deliberately so: entering three trips in a row is the point.
    `addScaleReadingOn()` files a past date at local midday so it lands inside the day it belongs to.

- **The actual weight rate needed DAILY weigh-ins, and was never meant to (2026-09-17).** Reported
  from a device: "don't see anything in Actual, but I didn't log a weight every day." The lookback
  in `actualPctPerWeekAt()` was `GOAL_RATE_MIN_DAYS` — the same 14 as the minimum SPAN — so the
  only way to reach a 14-day span inside a 14-day window was to have weighed on both exact
  endpoints. Miss either and the week fell back silently to its PLANNED rate, looking exactly like
  not having weighed in enough. Now uses `GOAL_RATE_WINDOW_DAYS` (28), which is what the goal
  screen's own rate has always used: look back 28 days, still require 14 days of span.
  `trailingAverage()` was already smoothing the gaps. **A window and a floor are different
  questions and one constant cannot answer both** — this is the second bug in this one line, both
  from conflating them. The existing test could never have caught it: it logs a weight every day,
  so the endpoints were always there. `test_weight_plan.js` now has a sparse fixture too.

- **Notes Phase 5, "Meals" (2026-09-17) — the Notes rebuild is complete.** The bridge between a
  recipe's two halves: `fields.ingredientText` (what you write, or what Convert produced) and
  `fields.ingredients` (rows with exact macros that feed Meals). `src/app-recipe-match.js`.
  - **Matching is a review, not an automatic pass.** A guessed food silently changes every calorie
    number downstream, so a guess is confirmed once — and then *remembered*
    (`STATE.diet.ingredientMap`), which is why a recipe's second import is quiet. That remembering
    is the whole payoff for sitting through the review the first time.
  - **Five statuses, per the spec**: matched, "did you mean…", not found, unit mismatch, no amount.
    Repairs are confirm, pick another, create the food (into the shared list, via the real Custom
    Foods form), enter an amount, fix the unit, or skip.
  - **Skipping records what was skipped.** It lands on the recipe and travels to the Meal as
    `notCounted`, which the recipe shows too — totals that quietly exclude something are worse than
    totals that say what they are missing.
  - **The parser reads what people actually write**: mixed fractions ("1 1/2 tsp"), plural unit
    words, list markers, parentheticals, preparation words. `kg`/`l`/`mg` normalise to the units the
    app stores with the quantity scaled — an exact conversion, so no prompt.
  - **One normalisation on both sides of every comparison.** The parser strips commas, so comparing
    its output against a raw food name could never match "Chicken breast, cooked". Caught by the
    test on its first run.
  - **Staleness is compared for INEQUALITY, not "is newer".** A meal records the exact `updatedAt`
    it copied; anything different means the recipe moved. A `>` test fails silently whenever two
    writes land in the same millisecond and says nothing useful if a clock runs backwards.
    Re-import updates the meal **in place**, keeping its id, so anything already planning it works.
  - **Shopping lists build on the plan the app already had** — seven real dates walked through the
    meal rotation, which is what you'd actually buy (a five-day rotation over seven days is two of
    A, two of B). That answers the spec's own open question. What's new: amounts now combine across
    units that convert (200 g + 1 oz is one line) while genuinely different measures stay apart,
    since converting cups of flour to grams needs a density the app doesn't have; skipped
    ingredients are listed anyway, marked; and the list can be saved as a **checklist note** —
    tagged `shopping`, linked to its recipes, with an **UPDATE** that re-plans while keeping what
    you've already ticked off. The dated to-do reminder stays as the other destination.

- **Notes Phase 4, "Convert" (2026-09-17).** Everything starts as a Quick note so that writing
  something down never requires deciding what it is first. Convert is the other half of that
  bargain: the moment you know, the note sorts itself into the right shape. `src/app-entry-convert.js`.
  - **Fixed, local rules — no AI.** The spec's twelve, in order, first applicable match wins. A
    rule with no target for the type you're converting TO doesn't apply at all, so the next one
    gets a look; otherwise converting to Journal would be a list of rules that match and do nothing.
  - **The one hard guarantee is that no text is ever dropped.** The test asserts it by
    reassembling every line back out of the plan for all six types. It is also why the
    `servings` rule stores the whole sentence ("Serves 4 generously") rather than trimming it to a
    digit — `recipeServings()` extracts the count from whatever is written instead. The tolerant
    reader is the right place for that, not a lossy rule.
  - **The review screen is the point.** The rules are a first guess, and a guess you can't inspect
    is worse than none. Every piece lands under a field with MOVE; anything unclaimed sits in an
    amber UNSORTED group with PLACE, survives onto the entry, and is shown there — never guessed at.
    Moves are by index, so two identical lines stay two separate pieces of text.
  - **Undo restores from a snapshot**, taken before the write, including `updatedAt` — an undo is
    not an edit. Reversing step by step would be merely nearly right, which is worse than no undo.
  - **Templates**: each type's fields render in place, and an empty one shows as "+ Add …" rather
    than a blank box, so a six-field Recipe with two filled in reads as a shape rather than as
    unfinished work. A typed entry's empty body says where its content actually lives.
  - **Converting to a hub** turns linked lines into real members, keeping the rest of each line as
    that member's context. **Converting back to Quick** flattens every field into the body in field
    order. Tags, links and structured recipe ingredients carry over untouched — the last of those
    because rebuilding `{foodId, qty, unit}` rows from text is exactly the guesswork this avoids.
  - Screenshot review caught three things the tests didn't: `servings` holding prose where the
    recipe code wanted a number, servings/time rendering in two places at once, and a converted
    entry showing an empty body box that invited you to write in the wrong place.

- **Notes Phase 3, "Hubs" (2026-09-17).** A hub is an entry whose job is to gather other entries in
  an order you chose, each with an optional line saying why it's there. Manual only — nothing fills
  a hub for you, which is what separates it from the saved-search "smart hubs" in the Backlog.
  - **Hub membership is a LINK**, routed through `entryOutgoingLinks()` rather than given its own
    relationship. That one decision is why "In hubs" falls out of the backlink index for free, why
    the card counts include it, and why deleting a hub vanishes from its members' lists with no
    cleanup pass — there is no second mechanism that could fall out of step.
  - **A hub's `body` IS its intro.** The spec gives the hub type a template field called `intro`;
    using it would have meant a type with one live text field and one dead one, which no reader can
    tell apart and which Convert (Phase 4) would have to pick between anyway.
  - **A hub is the one type you can create outright** (`+ HUB` on the list, or "new hub with this in
    it" from any entry). Every other type is reached by Convert, because a journal or a recipe is a
    quick note that turned out to be something — whereas nothing becomes a hub by accident.
  - Context lines belong to the **hub**, not the entry: the same note in two hubs needs two
    different reasons for being there.
  - **Removing a member never deletes it**, which is exactly why it's a separate action from delete.
  - **Reordering is move up / move down, not drag.** The spec offers both. The app's existing
    pointer-drag lives in Home, coupled to `UI.homeEditMode`, and its gesture half has no test
    coverage — duplicating it for a secondary affordance is the "two systems" trade this project
    keeps refusing. Generalising it properly is its own piece of work if drag turns out to matter.

- **Notes Phase 2, "Links" (2026-09-17).** Entries point at each other two ways, and both are read
  by one function: the `links` array (added through the picker) and `[[id]]` tokens written inline.
  - **Stored as an id, shown as a title.** That's what makes renaming safe — a rename rewrites
    nothing. The editor is the risky part, so it shows `[[Title]]` and resolves back on save: the
    original id first (so a re-save can't drift when two entries share a title), then an exact
    title match. A name that matches nothing is *reported*, not flattened into prose, and offers
    to create the note.
  - **`[[` autocomplete.** Every typed word must appear in the title, in any order — "notes setup"
    finds "Setup notes". Prefix matches rank first, then most recently touched; five rows, hubs
    marked, the current entry never offered. Arrows/Enter/Tab/Escape, and a "create as a new note"
    row that makes the target and keeps you where you were.
  - **Backlinks carry their sentence.** "Linked from" shows each linking entry and the sentence the
    link sits in, rendered as prose — a bare list of titles never answers *why* something links here.
  - **Unlinked mentions.** Entries that name this one in plain text without linking, with a LINK IT
    that rewrites the first occurrence into a real token. Whole words only, and titles under four
    characters are skipped, or a note called "Gym" claims every sentence in the library.
  - **Press and hold an inline link** to peek: a card with the target's title and first sentence.
    Tap it to go, release to stay. The click that follows a long press is swallowed, or "peek"
    would always also navigate.
  - **A back stack**, separate from the app's nav history — note → note → note all happen on one
    screen, so `goBack()` would have nothing to pop. Skips anything deleted in the meantime.
  - **The index is memoised, not incrementally patched.** The spec asks for incremental
    maintenance; a hand-patched backlink map is a thing that silently drifts from the text it
    describes, and a full rebuild is one pass (3ms at 1,000 entries, measured in the test). It
    invalidates on a version counter *and* on the entries array's length and identity — that last
    one means a reload, import, cloud pull or sign-out can't leave it describing notes that are
    gone, without every one of those call sites having to remember.

- **Notes rebuilt on one entry model — Phase 1, "Capture" (2026-09-17).** The spec is
  `docs/NOTES_SPEC.md`, which replaces the Notes section in five phases; this is the first.
  - **One record shape for six types.** `STATE.entries` — `{id, type, title, body, fields, tags,
    favorite, links, photos, createdAt, updatedAt, deleted}` — where `type` is one of quick /
    journal / writing / travel / recipe / hub. Everything starts as a **Quick note**, so nothing
    has to be filed before it can be written, and search, sort, tagging, linking and checklists
    are each written once rather than six times. See `src/app-entries.js`.
  - **Bodies are Markdown, stored as plain text.** Headings, bold, italic, bullets, numbered
    items, `- [ ]` checklists, URLs and `[[id]]` links. Plain text survives export, diffing and
    sync as exactly what was typed. The renderer escapes first and only ever inserts its own
    markup, which is what lets a body render with no sanitizer on the way out.
  - **Migration ran against real data, and kept its source.** Every old note became an entry with
    its date, title, photos and tag; the contenteditable HTML became Markdown. `STATE.notes` is
    left **exactly as it was** — a migration that deletes its own source has no way back. The old
    single-tag model's `general` meant "unfiled", so it migrates to no tag at all.
  - **Tags are freeform now.** Lowercase, no `#`, no duplicates, suggested by use count. This
    retires the twelve-colour tag palette and Notes' own Setup screen; colour is carried by the
    entry TYPE instead (six `--note-*` tokens), which lifts the old twelve-tag cap. Skills had
    borrowed that palette and now owns its own copy (`SKILL_COLOR_SOURCE`).
  - **Deletion is a tombstone**, with an undo on the toast — `showToast()` grew an optional
    `{label, onClick}` action for exactly this. A spliced array element can't tell another device
    anything; the next sync would silently undo the delete.
  - **NOT a second link system.** The spec models entry links as a bare id array; they are stored
    in `app-links.js`'s existing cross-entity `[{type, id}]` shape instead, so one array serves
    both note-to-note and note-to-meal/workout/reminder. `LINKABLE_TYPES.note` now addresses
    entries (the key stays `note` — it is written into every link already on disk).
  - **Deliberately deferred**, so what shipped is finished rather than half-present: the type chip
    is a readout (Convert is Phase 4), `[[id]]` renders but has no autocomplete or picker yet
    (Phase 2), and hubs are a type the model knows without a hub view (Phase 3).
  - **One promise in the spec the app can't keep yet:** it describes entries syncing as individual
    records merged by `updatedAt`. Cloud Sync writes the whole STATE as one blob, last-write-wins,
    so today the newer *device* wins. Per-record merge is a sync rewrite, not a Notes feature.

- **NetNavis, first slice (2026-09-17).** Shipped after the five open decisions were answered; the
  scoping entry under "Ideas worth considering" has the background.
  - **One at a time, chosen in Settings.** Not per-domain — the relationships between the six were a
    fun exercise in the source material but aren't modelled. `STATE.naviId`, default **null**, which
    is a real answer: with nobody jacked in the app is exactly what it was.
  - **Colours stay on the Navi.** Name, frame and portrait ring only. Sections keep their identity
    colours and link chips still derive from those, so `test_home_bar.js` needed no change.
  - **The dialogue box is a video-game text box** — pinned along the bottom, square 200×200 portrait
    on the left, text to the right, tap to advance, last tap closes. It lives in `index.html` beside
    `#toast` rather than inside `#app`, because `render()` replaces `#app.innerHTML` wholesale;
    `resetTransientUi()` closes it so it can't follow you to the next screen.
  - **The weekly review is the first surface**, via an `ASK <NAVI>` button rather than auto-play. A
    character that starts talking every time you glance at the box is what makes people stop opening
    the box, and the headline and chips already say what happened — this is the same week in
    somebody's voice.
  - **Templates, not a model — and the test is the reason.** `naviReviewFacts()` reduces a
    `weeklyReview()` result once; six voices read *that*, so they can't drift apart on the same week.
    Because the voices are pure functions, `test_navi.js` asserts the contracts each profile actually
    states: DigiMan emits no exclamation mark and no emphasis, Muze emits emoticons and never emoji,
    Wenceslas never emoji at all and always the Old English second person, StrikeMan always "bro",
    ClayMan never `!!!`. Built prompt-first those rules bake into strings no test can see.
  - **Vitalya is as written** — her spec's "slightly mean" nickname ships, rotated by week so it
    reads as a habit rather than a catchphrase. It sits at the casual end because "without real
    malice" is the same sentence of the spec. The escape hatch is the one the Operator already has:
    pick a different Navi.
  - The rule the feature is built under, written down in `src/app-navi.js` rather than rediscovered:
    **a Navi reacts to what you did; it never asks you to do it for the Navi.** Nothing awards
    anything, tracks a streak of its own, or asks to be visited.
  - **Not built:** streak/PR moments and bad-day mode (the other two surfaces scoped), and any
    model-backed voice.
- **COMPARE owns the measurement trend (2026-09-16).** The last of the restructure moves. COMPARE
  already held every trend in the app — body weight, lifts, lab markers — except the one that had
  two of its own inside MEASUREMENTS.
  - A **MUSCLES** group of chips now sits between BODY and LIFTS, which is what a tape measurement
    is between: the body's answer to what the lifts did. Only parts with two readings are offered;
    sixteen chips, most of them dead, would bury the three you actually track.
  - **Two surfaces retired from MEASUREMENTS.** An A-vs-B delta table between two hand-picked
    entries — confusingly also titled COMPARE, one tab from the real one — and a one-field-at-a-time
    chart behind a dropdown. Sixteen fields can only ever be charted one at a time that way, and
    one at a time isn't a question anyone asks of a tape. COMPARE draws up to four together, over a
    date range, and states each one's first → last in the period summary.
  - Weight and body fat recorded in a measurement entry are a **second, sparser series** from the
    one the daily log keeps, and the two can honestly disagree. They keep their own chips in BODY,
    labelled `(measured)`, rather than being silently merged into the daily log's or dropped.
  - No band and no verdict on a measurement: a circumference rising is growth on an arm and
    something else on a waist, and which one depends on what phase you're in. The app states the
    number and the direction.
- **DIET dissolves; the tab becomes D&E (2026-09-16).** The largest of the restructure moves, and
  the one that explains the rest. DIET held two unrelated things behind one button: **the numbers
  you plan against** (calories, macros, TDEE) and **the log of what you actually ate**. Those answer
  different questions at different moments, and neither was near the thing it belonged with.
  - **The targets went to PHASES / MEAL PLAN**, as a `TARGETS TO MEET` panel directly above the week
    they govern. Planning a week of food with the calories you're planning *for* on another tab is
    the same seam that once put a weight entry and its own chart two tabs apart. The panel leads
    with the calorie figure **and its provenance** — a phase target and maintenance-from-TDEE are
    different claims — then the macro split, then the calculator that turns one into the other.
  - **TDEE went behind a gear** on that panel, with the rolling estimate and its averaging window.
    The split is by how often you touch each: calories and macros are READ every time you plan; TDEE
    is what they're DERIVED from, adjusted rarely, and the averaging window is a setting about a
    setting.
  - The old TDEE field carried a note reading *"Not what today is compared against — phase X sets
    …"*. A correction like that is needed when a screen invites the wrong reading; stating what **is**
    in force, above the week it applies to, makes the correction unnecessary.
  - **The log went to D&E / MEALS**, beside the session log. Logging a meal and logging a set are
    the same act at the same moment of the day; they were only ever apart because one of them shared
    a tab with its own targets. WORKOUTS is now **D&E** — Diet and Exercise — with an
    EXERCISE / MEALS strip.
  - **The bottom bar is four buttons**, down from five. Its overflow bug is logged against exactly
    this strip, so every button that leaves it counts. A saved nav snapshot still pointing at DIET
    lands on D&E / MEALS with D&E lit, rather than on a blank screen.
- **Navigation restructure, part 1 of 2 (2026-09-16).** Four of seven moves, all of them the same
  correction: a thing had been filed where it was *built*, not where it is *used*.
  - **Set Volume moved into WORKOUTS.** It was in the planner, which is where you set landmarks
    once; it belongs where you're mid-phase and want to know whether this week's chest volume is
    near MRV. The section reads first — the landmark editor is folded behind `UI.landmarksOpen`,
    because on all but a handful of days the numbers *are* the feature.
  - **LINK NAMES is retired; a lift can have a nickname instead.** That screen existed to reconcile
    free-text exercise names against the library after the fact. Nothing types free text any more —
    every slot picks a real lift — so what it was actually serving was "I call this something
    shorter." That's now a **Nickname** field under the name when you add a lift to training maxes:
    a sparse `STATE.liftNicknames` map beside the library, read through `liftShort()`, cleared by
    emptying it. No retroactive linking, because there is nothing left to link. The picker itself
    was never the dead part — it still opens inline on every builder row, which is where linking
    always really happened.
  - **PHASES gained ARCHIVED.** Completed phases were stacked under the live ones, so the screen got
    longer the longer you used the app. They move to their own tab, newest first. A summary screen
    for them is still open.
  - **PHASES/GOAL is now PHASES/NEW**, which is what the tab does.
- **Phase cards fold; the planners name their target (2026-09-16).** Two asks that both came from
  the same feeling — not being sure what you were editing or whether it stuck.
  - **The ask was a SAVE button; what shipped is a DONE that folds the card.** Everything on a phase
    already commits on change, and a button that "saves" what is already saved teaches you the app
    needs permission to keep your work — then the day you leave without pressing it, you wonder. The
    AM/PM logs were lost to exactly that shape. But the thing it asks for is real: *a clear way to
    finish with a phase, be sure of it, and move to the next.* That's **closure, not committing**,
    and the honest form of it is an action that genuinely does something.
  - So cards fold, **one open at a time**. Closed, a phase is its name, dates and a one-line summary
    (`5-day rotation · 2 planned · −0.75%/wk`); open, it's the editor. This also fixes the screen:
    every phase used to render its whole editor at once, so a four-phase plan was a wall you
    scrolled through hunting for the one you meant. "Move onto the next" is a sequence, and leaving
    five expanded behind you rebuilds the wall.
  - Nothing open falls back to the phase you're **in**, so arriving lands on the one you came for.
    `'__none__'` is the explicit-DONE sentinel — distinct from `null`, or DONE on the current phase
    would instantly reopen it. **+ ADD PHASE** opens what it just made.
  - A card also flashes **"✓ saved"** for a moment when a field commits, then fades — the same
    consumed-flag trick as the water pulse. A permanent SAVED badge is chrome once you've read it.
  - **Both planners now name their target**: a select reading *"Adding to which phase"*, always
    shown. Both had a scope control and both **hid it when you only had one phase**, so the
    commonest case — every fresh install — answered the question by saying nothing.

### Architecture & infrastructure

- **"MESO1" retired in favour of RP-Style; `STATE.meso` becomes `STATE.program` (2026-09-13).**
  Groundwork for the goals/phases feature, which needs the word "mesocycle" back — and a cleanup
  worth doing on its own.
  - **The user-facing rename was already done.** The live style string has been
    `'Hypertrophy (RP Strength)'` for some time; all 14 remaining `MESO1` mentions were comments.
    What had gone stale was the **type**: `WeightsProgramStyle` still declared `'MESO1'`, a value
    that has never existed in `WEIGHTS_STYLES`. That's now corrected.
  - **`STATE.meso` → `STATE.program`.** It holds cycle count and *both* the weights and cardio
    program styles, so it applies to P-Zero exactly as much as to RP — "meso" was a misnomer for it
    from the start. It's persisted, so `loadState()` reads either key and `migrateState()` drops the
    old one once read, which keeps a save from showing both.
  - ~34 identifiers renamed (`getMesoLog` → `getRpLog`, `MESO_SET_TYPES` → `RP_SET_TYPES`,
    `blankMesoExercise` → `blankRpExercise`, `MesoConfig` → `ProgramConfig`, the `'mesoLog'` NAV
    mode, the `.set-row-meso` CSS class), plus user-facing copy that still said "meso": the
    **PROGRAM STRUCTURE** and **PROGRAM CYCLE** labels and the C25K/C2Triathlon length warnings.
  - **`mesoWorkouts` / `mesoLogs` deliberately keep their names.** They're legacy keys read straight
    out of saved JSON (`parsed.mesoWorkouts`) and folded into the unified model by
    `migrateState()` — they name *historical data*, not current code. Renaming them would either
    break migration for a pre-migration save or force reading the old key anyway.

- **`app.js` split into 18 ordered `src/app-*.js` scripts (2026-09-13).** Purely structural: no
  feature change, no user-visible change. 12.5k lines in one file became 18 averaging ~700, each
  with a header saying what it holds and what load order does and doesn't constrain.
  - **Done as pure slicing, not reorganisation** — every file is a contiguous range of the original,
    in the original order. That bought a verification that a feature-based reshuffle could not: the
    18 files reassemble to the original byte-for-byte, and a code-only comparison (comments and
    blank lines stripped) confirms all **10,568 lines of code survive in identical order**. The
    consequence is that a few files are positional rather than thematic — `app-day.js` is the daily
    timeline sitting where it always sat, between Budget and Hobbies. Reordering into pure feature
    files is a separate, riskier step deliberately not taken here.
  - **Only two code changes were needed**, both forced by the split and both fixing a real latent
    fragility:
    - `HOME_BOX_RENDERERS` held bare references to functions that landed in a *later* file. A
      `const` initializer runs during its own file's evaluation, so it read them before they
      existed and threw — taking the rest of that file's evaluation with it, which is why Home
      rendered blank. Each value is now an arrow, deferring the lookup to call time. The call site
      is unchanged: it already invoked whatever it found there.
    - **The FX loader's dynamic `import()` broke silently.** A dynamic import's specifier resolves
      against *the importing script's own URL*, not the document — so `./aesthetics/<key>/fx.js`
      started resolving to `src/aesthetics/...` the moment the code moved into `src/`. The failed
      import is caught by design (so a theme still renders without its effects), which means **every
      maximalist aesthetic would have quietly lost its runtime effects with nothing failing**. Only
      `test_aesthetic_fx.js` caught it. Now resolved via `new URL(..., document.baseURI)`, which is
      also correct under the GitHub Pages project subpath that a leading-slash path would break.
  - **`sw.js` was the other thing that would have broken silently.** `APP_SHELL` hardcoded
    `./app.js`, and `cache.addAll()` rejects *wholesale* if any single entry 404s — so a stale name
    there doesn't degrade the offline cache, it stops the whole thing from ever installing.
    `CACHE_NAME` bumped to `lifeman-v4` to clear the old entry for anyone already carrying it.
  - **`appSource()` in `tests/helpers.js`** replaces four tests' hardcoded `readFileSync('app.js')`.
    It reads the `<script src>` list straight out of `index.html`, so the structural assertions
    ("no render surface hardcodes a section hex", "no surface bypasses `dayModel()`") can never
    silently narrow when a file is split further — a hardcoded list would keep passing while
    quietly no longer covering the moved code.

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

- **The AM/PM quick logs lost what you typed — fixed, plus one field per sheet (2026-09-16).**
  Reported from a real device: "logs on Home don't save for some reason."
  - **Not reproducible in the sandbox**, and the reason it wasn't is the bug. The sheet opened a
    whole GROUP of fields and committed them only on SAVE; the backdrop was `closeLogPopup()`. On
    iOS you dismiss a number pad by tapping outside the field — the backdrop **is** outside the
    field — so the sheet closed, `render()` replaced `#app.innerHTML`, and every typed value went
    with it. A headless browser has no keyboard to dismiss, so the same script passes every time.
    Same class as the Cloud Sync keyboard item already on `TESTING_CHECKLIST.md`.
  - **A field now commits on `input` AND on `change`.** `change` alone fires on blur, and blur does
    precede the backdrop's click — but that still leaves a window where the value exists only in the
    DOM, and the DOM is what a render throws away. Writing on every keystroke closes it. The input
    path passes `quiet` so it *doesn't* re-render, because re-rendering would destroy the very input
    being typed into.
  - **One field per sheet**, so there is never a set of pending edits to lose. Sleep and its quality
    stay paired: one observation, one moment. The SAVE button is gone — it would imply the value
    wasn't already stored.
  - **Daily targets moved to Settings** (water, steps, sleep together). Water's target had lived in
    the water sheet on the reasoning that it was the only place the number was looked at, which
    stopped being true once the weekly review counted days hit against all three.
  - **The hydration colour marker resets daily.** It was one sticky value that survived until
    changed, with a staleness warning past twelve hours — a warning that existed only because the
    marker outlived its day. Today starts blank; yesterday shows beneath the scale as a reference
    (averaged across that day's readings, rounded), walking back to the most recent day that has
    any so a skipped day doesn't erase it. Nothing needed migrating: every reading was already going
    into `waterColorLog` with a timestamp, and the sticky `STATE.life.waterColor` was a duplicate of
    the latest one — now derived, so two sources for one fact can't disagree. Values stay 1–8;
    renumbering to 0–7 would migrate every stored reading to move a scale nobody reads as a number.
  - **A timezone bug caught by its own test:** the first cut sliced the date out of the ISO string,
    which is UTC. `dateKeyOf()` already existed with a comment warning about exactly this — an
    evening reading in a negative-offset zone would file under tomorrow, showing as "today" a day
    early and dropping out of yesterday's average.

- **Breaking a habit is permanent (2026-09-16).** The only irreversible write in the app, and the
  reason is the point: **a streak you can quietly repair on a bad Tuesday is decoration.** The
  record is yours to make and nobody's to edit afterwards, including yours.
  - This was initially pushed back on, as sitting near the roadmap's own "no streak-shaming" line
    and as friction on honest self-reporting. That reading was wrong, and worth writing down: the
    double-confirm isn't there to *discourage* marking a fail, it's the gate before an **irreversible
    write**. That makes it a commitment device — you binding your future self — rather than the app
    judging you, which is a different thing entirely and squarely the person's own call.
  - **The X is the first confirmation**, and one dialog is the second. A dialog before it asking
    whether you meant it was asking a question the tap had already answered, and two dialogs where
    the first only repeats the gesture is the kind of double-check people learn to click through
    without reading -- the opposite of what should guard an irreversible write. The one dialog
    names the habit (so a mis-tap on the wrong row shows up there, not afterwards) and states the
    cost.
  - **No do/avoid field on habits.** One was added and removed the same day: it changed nothing but
    the words on two tooltips, and a habit called "No drinking" already says which way it runs --
    better than a dropdown would, because the name is what you actually read on the row every day.
  - **The asymmetry runs one way only.** `kept` stays freely changeable, `kept → broken` included,
    because admitting a failure later is honest. Only `broken → anything` is refused, because that
    is the direction that rewrites history in your own favour. Both buttons stay on screen and
    legible when locked — the cross is the *record*, and greying it away would erase from the eye
    what the data still says — they simply no longer act, and say so.
  - `broken` **implies** locked; there is no separate lock registry. A second store for "is this one
    locked" is a second thing to keep in step, and the status already answers it.
  - **A shake and a red wash**, once, after the write — it reacts to what happened rather than
    trying to talk you out of it. Both are skipped under `prefers-reduced-motion`; the line carries
    the message, the movement is only the delivery.
  - **`habitBreakLine()` is the seam where a Navi will speak.** Templates, deliberately: the roadmap
    is explicit that building prompt-first bakes the personalities into strings nothing can test
    offline, turning a later model swap into an architecture change rather than a content one. A
    test asserts the line never mentions the streak it just cost, never asks for better, and never
    makes the app the injured party — *"a Navi reacts to what you did, it never asks you to do it
    for the Navi."*

- **The hydration strip carries yesterday; habits know "do" from "don't" (2026-09-16).**
  - **One strip instead of three rows.** `YEST ▪ | OLDER ▪▪▪▪▪▪▪▪ NOW`. Yesterday's reference used
    to sit on its own line under the scale, so a swatch and a strip were both claiming to say where
    you'd been. Folding it in puts the comparison where the eye already is; the divider is what
    stops it reading as the oldest dot in the run. The run drops 10 → 8 to keep it on one line.
    The two halves are decided independently — with exactly one reading ever logged, the swatch and
    a one-dot run would be the same dot printed twice.
  - **No scale number for hydration.** "4 of 8" is a position on a swatch strip, not a reading
    anyone takes or repeats — you know your hydration by the colour, and printing an index invites
    treating it as a score. The `aria-label` keeps the position for a screen reader, which has
    nothing else to go on. The clear moved **inline, to the left of the swatches**, appearing only
    when something is on the scale: the control that removes a reading now sits beside the reading
    rather than as a button further down that shifts everything under it.
  - **Where yesterday's average lives: nowhere.** It's derived on read by `scalePriorDay()` from the
    timestamped readings in `waterColorLog` — the same reason `liftBaseTmLb` and the weekly review's
    counts are derived. A stored average is a second copy that goes stale the moment you add,
    correct or undo a reading.
  - **Habits now carry a polarity**: `'do'` (kept = you did it) or `'avoid'` (kept = you didn't).
    Until now the app couldn't tell — "Stretch daily" and "No drinking" both had a tick and a cross,
    leaving the marks to mean whatever you remembered they meant. **`kept`/`broken` stay the stored
    values either way**; polarity changes only the words on the buttons, so switching a habit's type
    later can never invert its history. Absent on existing habits and read as `'do'`, which leaves
    their marks meaning exactly what they meant.

- **One reading per visit, an undo button, and the Bristol stool scale (2026-09-16).**
  - **Tap-to-toggle was deleting real data.** Tapping the shade you were already on removed that
    reading, on the reasoning that it was a toggle-off like the habit buttons. But two consecutive
    readings being the same colour is completely ordinary — it's what a stable day looks like — so
    the app would silently delete the first instead of recording the second. A tap now always means
    "this is my reading": the first in a visit logs, further taps **correct** it, and **undo is its
    own button**. Destroying data should never be something you do by tapping the same thing twice.
  - **Not "save on close"**, which was the other option raised and is exactly the pattern that lost
    the AM/PM logs. Dismissing a sheet must never be the difference between recorded and gone. Every
    tap commits immediately; the per-visit id only decides whether the next tap writes a new row or
    edits the one just made. Undo can reach **only** this visit's reading — an undo that could reach
    back into yesterday is a delete button wearing a friendlier word.
  - **The Bristol stool scale**, seven types with their clinical notes, as its own PM chip. It reads
    the same system from the other end (fibre and water show up here first), and a chip you tap once
    a day is the only way a record like this gets kept at all.
  - **Deliberately never averaged**, which is the one place the two scales diverge. Hydration colour
    is a continuum, so several samples average honestly. Bristol is not: types 1 and 7 are opposite
    failure modes and **their mean is a perfectly healthy 4**. Its readings are listed instead —
    `scalePriorDay(scale, average)` takes the flag, and a test asserts the same two numbers average
    for hydration and refuse to for Bristol.
  - Both run on one `SCALES` mechanism, so they can't drift apart in how they store, reset or undo.
    The colours are a muted brown ramp rather than a red/green health gradient: colouring 6 the same
    as 1 because both are "bad" would be the app grading you. It states where the healthy middle is
    and stops — a run worth acting on is a conversation with a doctor, not a flag in an app.

- **Drag the water number to adjust it (2026-09-16).** Replaces the type-an-amount box added hours
  earlier, which cost a row and a keyboard to say "and 150 more". The count between the +/- buttons
  is now a drag handle: pull up or down for 50 mL a step, or **one fluid ounce** in cups — the small
  unit each system actually uses out loud. The +/- still add a whole serving, so coarse and fine
  live side by side.
  - **It works with a finger on iOS**, which was the open question. Pointer Events are supported
    there and the app already drags this way (Home's edit mode reorders tiles with the same
    `onpointerdown` + `setPointerCapture` pattern). The load-bearing line is **`touch-action: none`**
    on the handle: without it Safari claims the gesture for page scrolling before a single
    `pointermove` arrives, and the drag silently never starts. Scoped to the number, so dragging
    anywhere else in the sheet still scrolls the sheet.
  - The handle **writes its own text mid-drag** rather than calling `render()`, which replaces
    `#app.innerHTML` wholesale and would destroy the element the pointer is captured on — ending the
    drag on its first step. `saveState()` still runs per step, so an app killed mid-drag keeps what
    you'd dialled in; the render happens once on release, which is when the chip behind the sheet
    catches up. Same hazard as the log inputs, one layer down.
  - Dragging is **absolute, not cumulative** — position maps to a value from where the drag began —
    so going up four and back down two lands where arithmetic says it should. Floors at zero.

- **The water chip opens its sheet (2026-09-16).** An access bug from the per-field sheets, caught
  immediately: the hydration colour scale lives in the water sheet, and it had only ever been
  reachable because the OLD pm sheet rendered *every* pm field — so you got to it through the
  Calories chip. Making each chip open only its own field turned the water chip into the only door
  to the colour tracker, and that door added a serving instead of opening. The chip opens now, and
  adding moved inside: the +/- servings it always had, plus a box for an amount that isn't a
  multiple of one glass (a 600 mL bottle), which counting glasses can't express. The `+` glyph came
  off the chip with the behaviour it described. One extra tap for a glass of water, against a
  tracker that had become unreachable altogether.

- **"Modded" sessions, and collapsible exercise blocks (2026-09-16).** The bad-day half of the
  on-ramp item, scoped from how the person already trains: when short on time they keep the T1 (or
  the first hypertrophy exercise — in RP-style programming the ordering already encodes priority,
  since you put the muscle you most want to grow first) and drop the tail.
  - **The flag is a LABEL and changes no arithmetic anywhere**, which is the whole finding. Scoping
    it turned up that the progression semantics it appeared to need **already existed**: both stage
    walks skip an entry with no logged reps (`if (!hasData) continue`) and the weight walks look
    back for the last entry that actually has one. An exercise you skip doesn't advance, doesn't
    fail, and doesn't trip a reset — the chain isn't broken, it just doesn't move. Anything you DID
    do progresses normally, and its sets count for PRs, because full-effort work is full-effort work
    whatever else you skipped. Years of manual "modded" sessions had been handled correctly all
    along; what was missing was only the **record**.
  - So `log.modded` exists purely because the app otherwise cannot tell a session you cut short from
    one you did in full — both are just "logged" — and that difference is the point of looking back
    at a week. **Set by hand, never inferred:** deciding on your behalf that you had a bad day is
    exactly the second-guessing this app doesn't do.
  - **Deliberately not a deload.** A deload is scheduled, reduces load and volume across the whole
    session, and is excluded from progression and PRs outright. A mod is unscheduled, keeps full
    intensity on whatever you perform, and excludes nothing. Both can be true of one session.
  - The weekly review counts a modded session **done** — you showed up, which is all it measures —
    and marks it: a chip, a per-day tag, and *"Every planned session done. 1 of them modded."*
  - **Exercise blocks fold shut**, which is the friction that drives cutting a session short in the
    first place: a long session is a lot of scrolling to reach the movement you're on. A folded
    block keeps its header and gains a progress summary, so a collapsed session still reads as a
    list of what it contains rather than a stack of blank bars. **Supersets keep their container** —
    the group box is structural, saying these are performed together, so folding happens to the
    members inside it. Per-view state on `VIEW.logCollapsed`, never saved: what's expanded on your
    screen is no more a fact about the workout than a scroll position is.
  - A block carries its **progress in its header, folded or not** — `2 / 4`, as a fraction rather
    than prose, because the useful question mid-session is "how much is left" and a fraction answers
    it at a glance. Scrolling past a block you left half-finished, that count is the thing that
    sends you back to it. Finishing one adds a green tick and dims the whole block.
  - **One completion treatment, shared** (`.is-done` + `.done-keep` in styles.css). There were three
    unrelated ones before: `.set-greyed` dimmed, `.superset-complete` recoloured, `.workout-cell.done`
    went green. The reminder version had already learned the hard part and its comment says why —
    **dim the CHILDREN, never the container**, because `opacity` on a parent compounds onto
    everything inside it and cannot be raised back by a child, which would render the one control
    you need to UNDO the completion at half strength. `.done-keep` marks what must stay legible:
    the undo control and any wrapper holding one. Reminders moved onto it; habits gained it (a
    habit you've marked either way is settled for the day); exercise blocks use it.
  - `tests/test_modded_workout.js` pins eight contracts, the first of which is a **negative**: if a
    future change quietly makes `modded` mean something to progression, that assertion fails. The
    last asserts the fold control computes to opacity 1 while the body is at 0.55 — the undo path
    surviving the dim is the thing most likely to regress.

- **The weekly review (2026-09-16).** The Best Shape list's #1, and the top unbuilt item for two
  weeks. `src/app-review.js`, surfaced as a YOUR WEEK box on Home.
  - **Every section is planned vs actual**, because that is the only comparison a person controls.
    This is also why it was only now buildable: before phases owned the plan, "planned" was a
    weekday guess, and `plannedWorkoutsOn()` now resolves phase → plan → rotation slot for any date.
  - `weeklyReview(mondayStr)` is **pure** — it reads STATE, renders nothing — so every count is
    testable without the DOM. Sections: training done vs planned day by day, PRs, habits, daily
    targets, weight as a rate, skills practice.
  - **The denominators are the whole feature**, and `tests/test_weekly_review.js` pins nine of them.
    A scheduled **day off leaves the denominator** (it is not a session you failed to do); an
    **unmarked habit is its own count**, never a broken one; targets count **days hit out of days
    logged**, not out of seven; an **opened-but-empty log is not a session**; an **unplanned session
    is `extra`**, never a miss and never in `done`; and days still ahead inside the week in progress
    are neither. A review that counts an unmarked habit as broken doesn't read as slightly wrong —
    it tells you that you failed at something you didn't do.
  - **No score, no grade, no streak, no week-completion bar** — the roadmap's own gamification line,
    enforced by a test. Labs, measurements and budget are deliberately out: wrong cadence, and
    stacking "you overspent" onto "you missed two sessions" is how a review becomes a screen you
    avoid opening.
  - **Weight is the one outcome metric allowed in, and only as a rate** — "−0.74%/wk, Standard Cut"
    — read through the same `actualPctPerWeekAt()` the long-cut flag uses, so the two can never tell
    you different stories about the same number.
  - **A week can be marked a deliberate off week.** It changes no count, only what the review *says*
    about them — the difference between a lapse and a choice, which is real data. Plus a free note.
  - **Calendar weeks, Monday to Sunday.** Set Volume already moved to calendar weeks for the same
    reason: a rotation can be five days, which makes "this week" meaningless if tied to it. The box
    defaults to the most recently **completed** week and never switches mode by day-of-week.
  - New settings: `stepsTargetDaily` and `sleepTargetHours`, edited beside their own log fields the
    way water's target already was — "hit your step target 5 of 7 days" needs a target to be a
    sentence at all.

- **`actualPctPerWeekAt()` always returned null — found and fixed while building the review
  (2026-09-16).** An off-by-one, live since the weight-plan work shipped. It asked for a window of
  `GOAL_RATE_MIN_DAYS - 1` days while `weightTrendRateBetween()` rejects any span under
  `GOAL_RATE_MIN_DAYS` — and the widest span inside a 14-day window is 13. The two constants meant
  different things ("days of data" vs "days between first and last") and the gap was invisible
  because a null is indistinguishable from not having weighed in enough.
  - The damage was not a blank readout. `weightPlanWeeks()` falls back to a week's **planned** rate
    when the actual is null, so every elapsed week read as planned — and `longCutState()`, whose
    stated premise is "a real walk over what you actually did, rather than a guess", was walking the
    guess. **The long-cut flag could only ever have fired on what you intended.**
  - Guarded by `test_weight_plan.js` section 7, which asserts both a real rate off a dense log and
    that elapsed weeks now read as `source: 'actual'`.

- **Exercise identity: categories dissolve into lifts (2026-09-16).** Arc 2. The model inverted.
  - **A lift owns its own training maxes.** It used to work the other way: `STATE.categories` held
    six fixed buckets (Squat, Bench, Deadlift, OHP, Back, Bonus), each owning four independent tier
    records with their own test weight, conversion and TM — plus one shared muscle, a hand-set
    upper/lower flag, and a free-text `exerciseName` on each T2 so a "Squat-tracked T2" could
    actually be a Leg Press. A workout's T1/T2 slot pointed at the *category*, an exercise pointed
    at a *lift*, and a category pointed at a lift too. **Three identities for one movement.**
  - The slot points at a **lift** now, and the lift carries its maxes, which deletes the mapping
    layer outright — and with it the rename/swap ambiguity, since there's no shared category record
    left for a rename to silently rewrite. Changing what a slot points at is always a swap.
  - **One test per SCHEME, not per tier.** A lift stores `t1` and `t2`; T2a/T2b/T2c all read `t2`
    and differ by their own `TIER_SCHEMES` intensity (0.80 / 0.75 / 0.75) and rep ladder. Nothing
    is lost — the old per-tier maxes existed because all four belonged to one category, and three
    T2 slots now hold three different *lifts*, each with its own number.
  - `STATE.liftMaxes` is **sparse and keyed by liftId**, the same pattern as `liftNotes` — a lift
    you've never tested has no entry. `muscle` comes off the lift (it always did), and
    **upper/lower/core is derived** from it via `MUSCLE_LU` rather than stored beside it where the
    two could disagree. **Abs → `core`**, since it's genuinely neither.
  - **The base TM is derived, not cached.** `recomputeTMs()` wrote a `tmLb` onto every tier and had
    to be called on every render of the screen that showed it — a cached derivation refreshed by a
    function that had to remember to run. It's computed where it's read now.
  - **The migration resolves each (category, tier) pair to a lift**, in three cases: a tier's
    `exerciseName` override becomes its own lift (the case the old model handled worst); otherwise
    the category's linked lift; otherwise a custom lift named after the category. Name matching is
    normalised on case and whitespace — merging two lifts later is easy, splitting one isn't. Dated
    TM adjustments come across intact.
  - **MAXES became EXERCISES**, listing lifts you've actually tested rather than six fixed buckets,
    each card carrying its maxes, its muscle, its derived upper/lower pill and its persistent setup
    notes. The workout builder's T1/T2 picker groups the whole library into *With a max* / *No max
    yet*. `defaultCategories()` no longer ships, so a fresh install starts with no maxes at all.
  - **GENERAL is gone, and `STATE.program.cycles` with it.** Rotations had already taken both of
    that setting's consumers — the WORKOUTS counter is derived from the phase, Set Volume is a real
    calendar week — leaving a number you could still type into that governed nothing, which is the
    most dangerous kind of setting because it looks like it works. Its one honest use (warning that
    C25K needs more weeks than you have) moved to the auto-fill picker, where it compares against
    the **phase's** length. BUILDER → WORKOUTS is four tabs now.
  - `tests/test_lift_maxes.js` pins seven contracts, the migration most of all — it runs once,
    silently, against real training data, and a mistake in it loses numbers nobody can reconstruct.
  - **Post-commit check (same day) found three migration defects, all fixed.** (1) Only "Deadlift"
    and "OHP" happened to name-match a library short, so an *unlinked* default "Squat" or "Bench"
    with real numbers would have become a custom lift beside Barbell Back Squat with the max on the
    wrong one — the four unambiguous defaults now alias by their fixed id, only while still wearing
    the default name, and never over an explicit link. (2) A category nobody tested and no slot
    referenced still manufactured a custom lift ("Bonus" on every save); it's skipped now. (3)
    Migrations here are in-memory and persist with the next natural save, so a custom lift made by
    the migration got a fresh `uid()` on every boot before that — same save, different answer. Its
    id is now derived from the name, so the migration is idempotent by construction rather than by
    luck. Also: the `t2Revealed` backfill read `liftId` before slots were repointed. The fixture
    now covers linked / aliased / custom / vanishing categories.

- **END PHASE, and auto-fill onto rotation slots (2026-09-16).** Commits 4 and 5 — the phases/
  rotations arc is complete.
  - **END fixes a phase's length at what it actually ran**, and everything after pulls forward on
    its own: dates are derived from lengths, so there is nothing to rewrite. That's the payoff of
    the model choice made back in the original phases work.
  - **Rounded UP to whole weeks**, so END really says *"this is its last week"* rather than *"it
    stops this instant"*. Weeks are the unit everywhere else and a 3.4-week phase would be the only
    one in the app that isn't — so the confirm names the **actual end date** and what follows:
    *"End 'Opening cut' after 2 weeks, on Sep 19? 'Diet break' then starts on Sep 20."*
  - **Only the phase you're IN can be ended.** A future one hasn't run (delete it); a past one is
    history, and shortening it after the fact would rewrite the record of what you did. The END
    button only renders on the current phase.
  - **Ending the LAST phase creates an open-ended successor**, preserving the invariant commit 1
    established — every date from the origin on belongs to a phase, which is what lets the plan
    resolvers have no "nothing covers this date" branch. Open-ended rather than a default eight
    weeks: you ended this block, so what comes next is precisely the thing you haven't decided.
  - The successor **continues the rotation** across the boundary via the same `appendSeededPhase()`
    helper `addPhase()` uses, so a five-day split ending mid-pass resumes where the calendar was.
  - `startPhaseWithNewRotation()` now routes through END rather than `addPhase()`, which appended at
    the end of the timeline — a rotation change is meant to take effect *next*, not after every
    phase already scheduled.
  - **Auto-fill fills rotation slots.** A pre-loaded program was written for a seven-day week, and
    that's the *program's* assumption rather than yours — so the picker says which rotation it's
    filling (*"C25K is written for a 7-day week; you're filling a 5-day rotation"*), flags when the
    rotation has fewer days than the program has sessions, and skips a session already in the
    rotation rather than producing a plan the slot editor would itself have refused.
  - `tests/test_end_phase.js` covers both, including the rotation-continuity check by walking dates
    past the boundary and asserting every hit is still a multiple of the rotation length.

- **Rotations, and the log key that had to change with them (2026-09-16).** Commit 3 of the
  phases/rotations arc.
  - **A plan is keyed by position in its phase's rotation, not by weekday.** `workoutRotationDays`
    (default 7) per phase; slot 0 is the phase's first day; a date resolves to `daysSinceStart % N`.
    The weekday grid everyone had is exactly the N=7 case. The every-other-day
    A/rest/B/rest/C/rest/D/rest split is eight days and could never be written on a weekday grid.
    Existing plans re-index once on load (`plansKeyedBy: 'slot'`), so a phase that started on a
    Wednesday has its Monday entries at slot 5.
  - **Meals follow either the calendar week or the workout rotation** (`mealRotation`) — one choice
    rather than a second free-running length, because two rotations drifting against each other
    would make "eat more on training days" meaningless. Week mode stays keyed by absolute weekday.
  - **A new phase CONTINUES the rotation across the boundary.** `copyRotationPlan()` takes an offset
    — the slot the calendar had reached — so A/rest/B on the last three days of one phase is
    followed by rest/C/rest, not by A/rest/B all over again.
  - **The log key is a per-workout session ordinal.** `STATE.currentCycle` — one global counter you
    advanced by hand — is gone. A session's cycle is derived once, from (workout, date), when the
    log opens: the existing session on that date, or one past the workout's last. Dense and
    monotonic per workout, so every progression walk that does `cycle − 1` keeps working (better
    than before — a skipped cycle used to leave a gap the walk stepped over), and existing logs
    keyed `N_workoutId` are already exactly this: **nothing migrates.** Two sessions of one workout
    can never share a key, which is what "workouts never overwrite each other in one week" means.
  - **Two consequences of that key, both forced.** Category-tier TM adjustments are queued by
    `fromDate` rather than `fromCycle`: a category is shared across workouts that each count their
    own sessions, so a date is the only axis they agree on (per-exercise and T3 adjustments stay
    ordinal-keyed — they live inside one workout). And Set Volume is per calendar week by
    `log.date`, counting a workout done twice in a week twice.
  - **The WORKOUTS screen is a calendar week** — real dates, Monday-first, each day showing what
    the rotation puts there. `WEEK X / Y` is derived from the date, so it can't drift from the
    calendar and can't be forgotten. A workout that lands twice in one week on a short rotation
    shows twice. An ALL WORKOUTS grid below files an unplanned session under today.
  - The **shopping list walks seven real dates** through the meal rotation instead of summing seven
    buckets: on a five-day rotation A B C D E, a week from Monday is A B C D E A B — two of A. A
    bucket sum would have said one of each.
  - **The same workout twice in one rotation is refused** in the editor — a training-design rule,
    not a data one, since ordinals made the key collision moot. **Rotation is immutable once a
    phase is current**; changing it starts a new phase. **Misalignment is flagged with the numbers**:
    "5 days doesn't divide into 6 weeks — the final pass stops 2 days in."
  - Along the way: the cardio tile's "done" signal was the log carrying a date, which every session
    now has the moment it opens — it reads `actualMinutes`/`actualDistance` instead; and a
    `complete` flag nothing ever set was dropped.
  - `tests/test_rotations.js` pins all seven contracts. Eleven existing tests had fixtures that
    wrote plans by weekday; each now anchors its phase origin on a Sunday so slot ≡ weekday, and
    one that switched a skill to a workout already in the rotation now uses a second workout.

- **The weight plan: rate schedules, asymmetric bands, and the long-cut flag (2026-09-16).**
  Commit 2 of the phases/rotations arc. New `src/app-weight-plan.js`.
  - **Three states, not two.** `phase.weightGoal` is nullable: `null` means no weight goal (calories
    fall back to TDEE, nothing is watched); `{direction:'maintain'}` means *deliberately holding*,
    which turns on drift detection. The difference is the point — "I haven't decided" and "I am
    holding on purpose" are different claims, and only the second is checkable. The old flat
    `direction`/`ratePctPerWeek` on the phase couldn't express "no goal", so every phase made a
    claim about eating whether you'd asked it to or not.
  - **Cut / Maintain / Bulk** are the labels; stored keys stay `deficit`/`maintain`/`surplus`.
    Choosing Maintain **locks the rate to zero** rather than merely labelling it.
  - **Asymmetric bands.** Cut: Conservative / Standard / Fast (*run for 6 weeks maximum*) / Extreme
    (*expect muscle loss*) at 0.5 / 1.0 / 1.5. Bulk: Lean Gain / Standard / Fast / Extreme at
    0.25 / 0.5 / 1.0. The old single list ran through `Math.abs()`, so ±1.2%/wk got the same label —
    and they don't mean remotely the same thing. **1.2%/wk is a Fast Cut but an Extreme Bulk.** Fat
    loss is rate-limited by energy deficit against a large store; muscle gain is rate-limited by
    protein synthesis, which doesn't speed up when you eat more.
  - **Rate schedule**: flat by default, "vary by week" expanding to a per-week grid seeded from the
    flat rate, each input tinted by its own band so a Fast Cut stretch inside a Conservative block
    is visible at a glance. The phase's single figure becomes the mean. Past the end of a shortened
    list the flat rate carries on, so extending a phase can't silently plan zero-rate weeks.
  - **The long-cut flag** is a hysteresis rule, not a threshold. Three kinds of week: `hard`
    (cut >1%/wk) increments the run, `soft` (cut ≤1%/wk) **pauses** it, `credit` (maintenance or
    surplus, including *no goal at all*) resets it and counts toward clearing. Six hard weeks in a
    row raises it; only six credit weeks clear it. Soft weeks pausing rather than resetting follows
    from the clearing rule — it takes eating at maintenance to get credit, not merely cutting less
    hard — otherwise 5 hard / 1 token soft / 5 hard would never flag. Cycling through a *real*
    maintenance week does reset it, which is the safer pattern and shouldn't be warned about.
    It crosses phase boundaries by construction, since the walk is over weeks rather than phases.
  - **Actual for elapsed weeks, planned for upcoming ones**, read through a 14-day trailing window
    (`GOAL_RATE_MIN_DAYS` — a single week of scale weight is mostly water). Consecutive weeks
    therefore share seven days, which is right: the flag is about sustained behaviour.
  - **No lingering flag on the bulk side.** A prolonged deficit has real costs and a recovery
    requirement, which the clearing rule encodes. Gaining too fast just makes you fatter — visible,
    self-correcting, demanding nothing afterwards. It still gets an Extreme Bulk band: labelled,
    just not watched.
  - **Maintenance drift** alerts when an explicit Maintain is actually moving: ±0.25%/wk sustained
    over ≥14 days, just under the Conservative Cut / Lean Gain floor so it means "drifted into a
    direction" rather than "fluctuated".
  - The cut side's leanness note **personalises off a recent `bodyFatPct` reading** when there is
    one within 90 days, and stays generic otherwise.
  - **One bug caught by screenshot rather than by tests:** the flag walks planned weeks, so a block
    sketched for November raised a notice reading *"you have been cutting hard for six weeks"* in
    the present tense. `flaggedSince` also used the week's **end** date, which called a run
    "planned" whenever its sixth week merely finished in a few days. Now anchored to the start date,
    with a separate *A LONG CUT AHEAD* wording for runs still in front of you.
  - **A second-pass review found seven more.** The serious one: `migratePhaseWeightGoals()` ran only
    from inside `migratePhasesToOneTimeline()`, which returns early for any save that's already one
    timeline — so a save from *between* commits 1 and 2 had flat `direction`/`rate` and no
    `weightGoal`, and the normaliser then set it to null and **dropped the rate**. It now runs
    unconditionally on every load, and there's a test that writes exactly that in-between shape and
    reloads. Also: the projection compounded the **mean** rate raised to a power rather than each
    week in turn — `(1+a)(1+b) ≠ (1+(a+b)/2)²`, a quarter-pound over four weeks on the test fixture
    and the whole reason per-week rates exist; the week-walk's 52-week clamp could knock the cursor
    off the phase's own week boundaries, so a per-week schedule read week 3 as week 2; drift read
    the *whole* phase rather than a trailing window, so a 200-day maintain would average a fortnight
    of real loss against six months of holding and report nothing; the forward horizon was capped
    only by a loop guard; the `GoalPhase` type still declared the flat fields; and `leannessNote`
    took a parameter it never read.

- **Phases became the primary record — one timeline, goals optional (2026-09-16).** Commit 1 of the
  phases/rotations arc. The model inverted: a **goal** used to be the record, with a `kind`
  (`weight` / `exercise`) and phases hanging off it, so there were two independent sequences that
  could overlap and *you could not create a phase without first inventing a goal*. Now a **phase**
  owns a stretch of time and a goal is something it optionally carries. "Working out" with no goal
  is a first-class state.
  - **`phaseTimeline()` replaces `phaseSchedule(goal)`**, anchored at a single `STATE.phaseOrigin`.
    `phaseForDate(date)` lost its `kind` argument — one sequence means at most one phase covers a
    date, so there is nothing to disambiguate.
  - **A PERPETUAL phase** (`weeks == null`) runs until something replaces it, has no end date, and
    must be last. Clearing the Weeks field makes a phase perpetual again; `+1 WK` on one fixes its
    length at however long it has *actually* run rather than starting from 1.
  - **A perpetual phase is auto-created on first run**, which is what let both plan resolvers drop
    their `'global'` branch entirely. `STATE.exercisePlan` and `STATE.diet.mealPlan` are **retired**
    — they only ever existed as the "no phase covers this date" fallback. The origin is seeded from
    the earliest logged date, so the phase covers existing history rather than starting today.
  - **No target weight anywhere.** A phase owns a rate and a length; where you land is the OUTPUT.
    That deleted `phasePlanSummary()`'s reaches-target / short-by-X reporting, the required-rate
    line, and `addPhase()`'s gap-closing seed — which existed solely to solve
    `start × (1+r)^weeks = target` and had nothing left to solve for.
  - **Start weight comes from `trendWeightOn()`** — the 7-day trailing average, deliberately the
    same line the Body Weight chart draws so a projection and the chart can never disagree. It
    averages whatever falls in the window, so "a full week of weigh-ins" and "one weigh-in" are the
    same operation. Falls back 14 days (`GOAL_RATE_MIN_DAYS`, already the app's "too stale to be
    honest" bound), then returns null and the screen asks rather than guessing.
  - **Two real bugs found by the tests**, both from the retirement: `deleteWorkout()` swept
    `[STATE.exercisePlan]` and crashed on `undefined`, now sweeps `allExercisePlans()`; and
    `loadState()`'s `STATE.exercisePlan` guard ran *after* the fold, re-creating the retired global
    on every single load. The legacy entry conversion it did moved inside the fold, where it
    happens before the copy — `copyWeekPlan()` reads `refId`, so copying an old-shape
    `{id, workoutId}` entry first would have silently blanked every assignment.
  - Ten test files rewritten against the new model. `test_weight_goals.js` became a focused trend +
    rate-band test (the goal record it tested is gone, the arithmetic under it isn't);
    `test_exercise_targets.js` keeps its `bestForLift()` coverage and drops the `exTargets` UI,
    which returns phase-owned in a later step.
  - **A second-pass review found four more, none of which a green suite could see.** (1) The Body
    Weight chart's phase-boundary plugin still read `m.kind` off `phaseBoundaryMarks()` to pick a
    colour and a row — Chart.js is CDN-blocked in tests, so every mark silently drew in the wrong
    colour on the wrong row. One timeline can't collide on a date, so it's one row now. (2) **The
    projection chain compounded from the origin's weight**, so a perpetual block auto-created from
    six-month-old workout logs — no weigh-in within 14 days of its start — poisoned every phase
    after it with `null`, even with a fortnight of daily weights. A phase that has *started* now
    reads the trend at its own start date; only future phases chain from the plan. (3) A perpetual
    phase had `plannedLbPerWeek: null` because it has no end weight to average to — but its rate is
    real, and `phaseCalorieSeed()` computed `null × CAL_PER_LB = 0` and would have seeded
    *maintenance* calories for a phase that's cutting. It now reports the first week's change; the
    seed returns null only when there's no start weight at all. (4) The PLANNED row printed
    `+0.00 lb/wk` for that same null, which reads as a rate rather than the absence of one.

- **PHASES and BUILDER replaced GOAL and SETUP (2026-09-15).** The second half of the restructure,
  and the reason the meal-plan work above came first. Same five bottom-bar buttons:
  `WORKOUTS / PHASES / BUILDER / BODY / DIET`.
  - **The old pair split by SUBJECT** — your goal over here, the screens that configure things over
    there — which filed "assign workouts to weekdays" and "build a workout" side by side under
    SETUP even though one is a plan and the other is a thing. **The new pair splits by what you're
    doing.** PHASES sets the goal and maps workouts and meals onto time; BUILDER constructs the
    workouts and meals those plans point at. Builds are standalone and reusable; plans belong to a
    phase.
  - PHASES: `GOAL / WORKOUT PLAN / MEAL PLAN`. The two plan panes moved in whole from SETUP —
    both were already phase-owned in the data, so they were sitting under a heading that had
    stopped describing them.
  - BUILDER keeps the WORKOUTS/DIET panel switch, now a real segmented toggle (`.unit-toggle`,
    the control LB/KG uses) rather than two loose buttons — it halves how many subnav buttons
    you're choosing between at once. `VIEW WORKOUTS` became `ALL WORKOUTS` to parallel `ALL MEALS`.
  - **Retired subtab values land on their successors** rather than rendering nothing: `goal` →
    PHASES, `setup` → BUILDER, `longevity` → DIET, in both the router and the tabbar's active
    check — a nav snapshot carrying `goal` must not render PHASES with no button lit.
  - Ten in-app breadcrumbs pointing at "Setup → …" were rewritten; they were directions to a tab
    that no longer exists.

- **GENERAL was dissolved into where each part is used (2026-09-15).** It held four unrelated
  things behind one heading that described none of them.
  - **Units (LB/KG) → the app-wide Settings screen.** `STATE.units` governs body weight,
    measurements, lab results and barbell loads alike; living under the exercise section meant an
    app-wide switch was reachable only from the one section that happened to have a drawer.
  - **Rounding increment → leads MAXES.** It exists solely to turn a training max into a loadable
    bar, so it reads first and every target below it is rounded by it.
  - **Rest behaviour → the rest picker overlay.** It only ever fires while you're logging a set,
    and the picker is the one surface that appears exactly then. The stored "Default length"
    select was dropped entirely: `openRestPicker()` already seeds from `lastUsedSeconds`, so the
    timer holds whatever you rested last — a stored default was a second answer to a question the
    picker already answered, and one of them was always going to be the stale one.
  - **Program cycle length stayed put**, and is the open question. It's the last survivor of the
    pre-phases model — a single global "the program is N weeks long" — while a training block now
    carries its own `weeks` and `phaseSchedule()` derives every date from those. Two competing
    notions of program length, one of which doesn't know goals exist. Moving it would only put the
    contradiction on a nicer screen; it likely wants subsuming into phases instead.
  - `tests/test_settings_placement.js` pins all four, including that no LB/KG switch remains
    reachable inside the exercise section — a settings control that moves to the wrong screen is
    invisible rather than broken, so nothing would throw.

- **Meal plans became phase-owned (2026-09-15).** The first step of the PHASES/BUILDER
  restructure, and the one genuine gap it exposed. A weight phase already carried its own
  `calorieTarget`, but `STATE.diet.mealPlan` was global — so Phase 1 at 2,100 cal and Phase 2 at
  2,300 shared a single week of meals that could only ever match one of them. `phase.mealPlan` now
  mirrors `phase.exercisePlan` exactly.
  - **It hangs off the WEIGHT phase, not the exercise one**, because that's where `calorieTarget`
    lives. `calorieTargetForDate()` resolves through `phaseForDate(date, 'weight')` and the meal
    plan has to agree with it — a week of meals answering to a training block while its calorie
    target answered to a weight phase would be two screens disagreeing about the same day.
  - **No migration, by the same trick the exercise plan used.** `STATE.diet.mealPlan` keeps its
    meaning as the plan in effect before any phase claims one, so nothing had to move and anyone
    who never creates a weight goal sees the Meal Plan behave exactly as it always has.
  - **A phase with no `mealPlan` key falls through to global rather than resolving to an empty
    week.** `loadState()` deliberately does *not* seed one, unlike its `exercisePlan` counterpart
    which creates an empty plan when missing. Seeding here would have silently replaced the meal
    plan of everyone who already had a weight goal with a blank one — the test pins this.
  - **No active-rest branch**, the one place this departs from `exercisePlanInEffect()`. A deload
    changes how *much* you eat, not *what* you eat, and `calorieTargetForDate()` already overrides
    the number to maintenance for those weeks. Swapping the meals too would be the same override
    applied twice in two different units.
  - The editor routes through `mealPlannerPlan()`, the exact counterpart of `plannerPlan()`, so it
    can never change a different week than the one it's showing you. `renderMealPlannerScope()`
    reuses `.planner-scope` and adds the calorie target — seeing "Opening cut — 2,100 cal/day"
    above the week is the difference between planning meals and planning meals FOR something.
  - **Fixed a latent bug on the way past:** `deleteMeal()` swept no plan at all, so a deleted meal
    left a blank slot in the plan forever. Harmless-ish with one global plan; one dangling
    reference *per phase* once plans multiplied. Now sweeps `allMealPlans()`, matching
    `deleteWorkout()`.
  - `tests/test_phase_meal_plan.js` — five contracts, including the aliasing one asserted by
    *mutating* one phase's plan and checking the other, since two plans can hold equal values and
    still be the same object.

- **Lab biomarkers, and where you stand (2026-09-15).** From the "Best Shape of Your Life" scope,
  ranked #3 — the actual missing piece for a longevity focus. New `src/app-labs.js`, a LABS subtab
  under BODY, `STATE.labs` shaped like `STATE.measurements` (sparse and dated: a marker that draw
  didn't include simply isn't a key). 32 markers across six groups, 16 core and the rest behind
  MORE MARKERS, sortable grouped or A–Z.
  - **Two ranges, because one would lie either way.** `ref` is the interval your lab prints as
    normal; `target` is the stricter figure someone optimising is aiming at. The test that pins it
    says why best: ApoB at 96 is *inside* the reference and *outside* the target — one range would
    have said "fine" there.
  - **The position bar reuses the volume-landmark construction**, which was suggested rather than
    my plan and was the better call. MEV/MAV/MRV paints zones as a gradient across a track with a
    marker line; `target` nesting inside `ref` gives the same five stops. It also works from a
    SINGLE reading, which matters because labs come back two to four times a year — a trend line
    needs two draws and this doesn't. Pure CSS, no Chart.js.
  - The zone walk handles any SUBSET of the four bounds: a ceiling-only marker draws no bottom band,
    a floor-only one no top band, a marker with no target draws no target band rather than inventing
    one, and a marker of your own starts unbounded and draws no bar at all.
  - **WHERE YOU STAND reads latest-per-MARKER, not off the newest panel** — panels are sparse, so
    the newest reading of one marker and of another routinely come from different draws.
  - **The line this feature does not cross:** it records and positions, never interprets. Every
    shipped number is an editable default, stored as sparse overrides so a changed default in a
    later release still reaches anyone who never edited that marker. Sex-specific intervals are
    deliberately not modelled — encoding a split would still be wrong for many people while looking
    far more authoritative than it is. The disclaimer is said once and hands interpretation back to
    a doctor.
  - Two bugs the tests caught, both mine: `labStatus()` returned a truthy object for a marker the
    catalogue has never heard of, and deleting a custom marker made its past readings vanish from
    the card — while the delete confirm promised they would stay. They fall back to the raw key now.
  - **Still open:** comparison — see "Lab comparison, agreed direction" under Ideas worth
    considering for the shape that was settled on and why a panel-vs-panel compare isn't it.

- **Blood pressure moves to Labs, as two markers with two sources (2026-09-15).** Reasoning given
  with the ask: most people don't take BP at home, they get it taken at the doctor — in the same
  appointment the blood is drawn — so it belongs beside the panel, not on a morning chip between
  sleep and steps.
  - **Two markers, not one paired reading.** `bpSystolic` and `bpDiastolic` have genuinely different
    reference numbers (≤130/≤120 and ≤85/≤80 as shipped defaults), and splitting them means each
    gets a position bar, a ghost-dot trail and movement colouring for free rather than needing a
    paired special case threaded through all of it. New `vitals` group.
  - **Two sources that coexist, which is the actual design ask:** inside a lab panel like any other
    marker, *and* standalone dated readings. `labHistory()` unions them — the one function every
    bar, trail, chart and history list already reads, so the two-source-ness exists in exactly one
    place.
  - **A panel WINS on a shared date, and only shadows** the standalone reading rather than deleting
    it. The drawn-blood reading was taken with a cuff by someone doing it for a living; but a
    destructive override would throw away a reading to express a preference. Verified: a home
    reading of 126 on the panel's date is kept in state while the panel's 132 is what's shown.
  - **`STATE.life.dailyLog` stays exactly where it is** and becomes the standalone store. It was
    already a dated store of BP readings, so this means **no migration and no history lost** — and
    crucially no turning sixty days of home readings into sixty one-marker "lab panels" that would
    bury real bloodwork. Only the entry point moved.
  - **A BP-only door** (`+ BP` beside `+ ADD A PANEL`): a reading without inventing a panel, for
    people who do check routinely. Both halves or neither — a lone systolic isn't a blood pressure,
    the same rule the old chip enforced.
  - Removed from Home's AM strip (now four chips) and from `WEIGHT_METRICS`. The `parts` machinery
    that existed solely for BP is **deliberately left in place** — it's what any future paired
    metric would use, and tearing it out would mean rebuilding it verbatim. COMPARE picks BP up
    under its LABS group instead, so charting is unchanged in kind.
  - Its `test_body_metrics.js` section moved to `test_labs.js` rather than being deleted: same
    coverage (both halves, shared dates) plus the union and override the daily log now feeds.

- **The water chip pulses; HOME moves to the wordmark (2026-09-15).** Two small ones asked together.
  - **Water's accent is a pulse now, not a state.** It jumps to `--accent` on tap and fades to
    `--text` over 0.4s. Water is the one chip tapped several times a day, so the confirmation has
    to be instant and then get out of the way — a colour that *stays* says "logged today", which the
    chip's border already says, and tells you nothing about the tap you just made. Measured across
    the animation: `rgb(254,50,216)` → `rgb(238,166,243)` → `--text`.
    - The flag is **consumed inside `logChip()`** as the markup is built, so exactly one render
      carries it — the one `addWater()` queued. Left set, it would replay on the next unrelated
      render, which is the failure this avoids. A renderer touching state is worth the comment it
      has. `prefers-reduced-motion` drops the animation.
  - **HOME left the bottom bar for the wordmark.** LIFEMan.EXE is on every screen already, so
    routing home through it costs no chrome and buys back a slot on the strip with the logged
    overflow problem. Health & Wellness is now **five buttons** (WORKOUTS/GOAL/BODY/DIET/SETUP),
    down from seven when the overrun was first reported — Longevity's retirement took one, this
    took another. A real `<button>`, so it takes keyboard focus.
    - **The tradeoff, taken knowingly:** home is a reach to the top of the screen rather than a
      thumb-height tap. Worth it for the room, and the wordmark is a bigger target than the button
      it replaced.
    - Four tests asserted the bar's exact labels; all updated. Home's own bar now has *nothing*
      marked active, which is its own small assertion.

- **Setup notes that belong to the lift, so they outlive the phase (2026-09-15).** Asked as "if you
  do an incline curl again a year later, your note of 'Bench incline 30 degrees' stays".
  - **The existing `notes` field could never have done this.** It lives on the workout *log*, keyed
    by cycle and workout — right for "how did it feel today", wrong for a fact about the exercise
    that was true last year and will be true next year. A new phase, a program rewrite or a cleared
    log takes it with them.
  - So a setup note hangs off the **liftId** — the only identity here that survives any of that. A
    test wipes `STATE.logs`, jumps the cycle forward by twelve, empties `exercisePlan` and `phases`,
    then reloads, and the note is still there.
  - **Stored in a sparse `STATE.liftNotes` map, not on the lift.** `LIFT_LIBRARY` is a source
    constant, so a shipped lift has nowhere to keep one — the same reason lab range overrides are a
    sparse map beside the catalogue rather than fields on it. Clearing a note deletes the key rather
    than storing `''`, since every caller reads it as `liftNote(id) ?`.
  - **The second payoff, which falls out for free:** the same movement as a T3 in one workout and an
    RP exercise in another shows one note, because it was keyed on the identity they share rather
    than on either of them. Wired into all three exercise block types (RP, GZCL tier, T3).
  - Rendered **above the sets** — it is what you read while setting the bench up, not something to
    review afterwards. A test asserts its position in the markup precedes the first set row.
  - **Presented as a collapsible field with the header as the signal** (revised on the same day from
    an always-visible inline note). Collapsed, an exercise with nothing written costs one quiet
    line; the "NOTES" header is **lit in `--accent`** when there is something to open and muted
    when there isn't, so the field can stay shut without hiding that it has contents. Taking the
    colour from `--accent` means every aesthetic gets its own version of "look at me" for free —
    verified as `rgb(99,80,143)` unlit vs `rgb(255,43,214)` lit.
    - Open state is a **map** keyed by liftId, not a single id: a workout is several exercises and
      opening one has no business closing another, since you might be comparing two setups.
    - Saving on blur **keeps the field open**. Blur fires on every tap outside, not just on "done",
      so collapsing there would snatch the note away at the least useful moment.
    - The tradeoff, accepted: a written note now takes one tap to read rather than being on screen.
  - **An exercise with no lift linked gets no note row at all.** There is no identity to hang one
    on, and offering it there would be a second, silent way to create a lift — where linking is a
    deliberate screen with its own "did you mean" guard, precisely because a wrong link fuses two
    exercises' histories. The cost is discoverability: you only learn setup notes exist on an
    exercise that is already linked.
  - Two things the tests caught, both mine: §4 originally *skipped itself* when no workout had an
    enabled T3 — and `STATE.workouts` is empty on a fresh save, so it reported PASS having checked
    nothing. And counting `/lift-note/g` counted three class names inside one rendered row.
  - **Adding your own exercise already shipped and needed nothing** — worth recording, since it was
    raised as a request. The lift picker has muscle-group chips (15 of them), a search across every
    lift, and a "NOT IN THE LIST?" form taking name / short form / muscle that calls
    `addCustomLift()`. A created lift lands in `STATE.lifts`, is returned by `allLifts()` and
    `liftsByMuscle()` forever after, links itself to the slot that created it, and — because notes
    key on liftId — takes its own notes exactly like a shipped one. Verified end to end through the
    picker's real form rather than by reading the code. An exact-name match reuses the existing lift
    instead of creating a duplicate.

- **Supplements become a real regimen; the hardcoded seven become a preset (2026-09-15).** Step 1 of
  dissolving the Longevity section, proposed as "supplements should be able to be consolidated into
  a separate section like a Meal planner… this current supplements regime can be a preset".
  - **What was wrong with it:** `SUPPLEMENTS` was seven hardcoded rows in `app-data.js` you could
    tick and nothing else — no adding, no editing, no dose of your own, no sense of *when* anything
    was taken. A reference card with checkboxes, which is why the section it lived in never grew.
  - `SUPPLEMENT_PRESETS` mirrors `SKILL_TEMPLATES` (key / name / blurb / `build()`), so the seven
    install in one tap into a list you then own. Appending, not replacing — installing on top of an
    existing regimen is a real thing to want — but a re-install **asks first**, since tapping ADD
    twice would otherwise quietly give you two of everything.
  - **Stacks are this screen's supersets**, which is what was asked for: a named bundle taken at one
    slot, ticked in one tap. The stack owns the slot, so moving the group moves its members;
    deleting the stack keeps them and just clears `stackId`, because a bundle is a convenience and
    the things in it are the data. Members keep their own tick — the bundle exists to make the
    common case one tap, not to stop you recording that you skipped one today. A tap on a *partly*
    done stack finishes it rather than resetting it: the gesture reads as "take the rest".
  - **Medicine is the same model with a `kind` field**, not a parallel one — the same call the plan
    entries made with `{kind, refId}`. A `photo` slot exists on every item but capture is a
    deliberate later step: base64 rides to localStorage *and* on to Firestore through Cloud Sync, so
    ~20 items × ~100KB is a cost to add on purpose rather than discover.
  - **THE LOG IS KEYED BY ID, and that is load-bearing.** The old log keyed ticks by *name*, which
    was safe only while the list could never change. The moment it became editable, renaming
    "Vitamin D3" would have silently orphaned every tick of it. `migrateSupplements()` re-keys
    existing history onto ids by name, and is idempotent. A save that never ticked anything starts
    **empty** with the preset on offer — assuming a regimen nobody used would be putting words in
    their mouth.
  - **Placed under DIET rather than taking a bar button**, on an in-screen `unit-toggle` strip
    (FOOD & TARGETS / SUPPLEMENTS). The bar it would have joined is the one with the logged overflow
    bug; a test asserts it adds no button there.
  - Steps 2 and 3 followed the same day — see below.

- **Anchors can rotate; Longevity retires (2026-09-15).** Steps 2 and 3 of the same restructure.
  - **Skin cycling was the only thing in Longevity that actually computed anything**
    (`daysSince(start) % 4` → "tonight is Night 2, Retinoid"); the rest was static reference text.
    Folding it into a plain anchor would have thrown that away, so an anchor can now carry
    `rotation: { start, steps[] }` and shows whichever step applies to the day being rendered.
    Skin cycling is the first user; anything on a repeating N-day cycle gets it free.
  - **It is a DISPLAY rule, not a second kind of anchor.** `anchorTextFor()` changes only the label
    and detail; times, category, the open flag and how exceptions treat the block are untouched, and
    a rotation-less anchor falls straight through. That is what stops every surface downstream of
    `scheduleBlocksForDate()` from having to learn rotations exist — a test asserts the block's
    `start`/`kind`/`anchorId` are unchanged.
  - A date **before** the start returns `null`, not a negative index — "night −2 of 4" isn't a
    thing, and browsing back through the calendar past the start is the ordinary way to hit it. The
    anchor still renders, as itself.
  - The label **keeps the anchor and appends the step** ("PM skin routine — Retinoid"). Replacing it
    outright would make the timeline read as a different block every night.
  - **The circadian block was a shadow copy of anchors that already existed** — `wake`'s detail is
    `SLEEP_PROTOCOLS[0]` almost verbatim, two copies of one piece of advice free to drift. The
    anchors are the copy that can be scheduled and ticked, so they win; `SLEEP_PROTOCOL_ANCHORS` is
    the installable version for anyone whose schedule no longer has them. Presets install additively
    and skip by label, because topping up an edited schedule is the common case.
  - `migrateSkinCycleToAnchor()` moves `skinCycleStart` onto the PM skin anchor, so **anyone
    mid-cycle keeps their place** — tonight is the same night it was before the change. With no PM
    skin anchor to carry it, nothing is invented on their schedule and the date is left alone.
  - **The Health & Wellness bar went from seven buttons to six**, which is a real dent in the
    reported overflow bug as a side effect rather than a fix aimed at it. A stale `longevity` subtab
    (it rides in nav snapshots) lands on DIET → SUPPLEMENTS, the screen that inherited what you were
    most likely after. `src/app-hobbies.js` is deleted — it was named for the guitar catalogues that
    became the first Skill, and Longevity was the last tenant.

- **Compare days: what the Agenda was for, with the day set made explicit (2026-09-15).** Proposed
  immediately after retiring the Agenda — "this can all be built back with a compare-days button…
  similar to the agenda but simpler" — and it is strictly more capable than what it replaces. The
  Agenda could only ever answer "what's coming up in the next seven days". This answers that (pick
  the next few) *and* things it never could: this Tuesday against next Tuesday, or the three days
  you actually train.
  - **Four design decisions, each taken on the recommended option:**
    1. **Selection: tap cells to multi-select.** While comparing, a grid tap adds/removes a day
       instead of selecting it. One gesture with two meanings, which is only safe because the mode
       is explicit, the cells look different in it (dashed borders), and there's a visible way out.
    2. **Layout: kinds as rows, days as columns.** This is what "compare" actually means — the eye
       runs along a row and the difference is in line with itself. Stacked cards (the Agenda's own
       shape) put the two things being compared a screen apart. Rejected side-by-side full-detail
       columns: at 390px three are ~120px each, unusable at four.
    3. **Content: only what's distinctive** — *revised the same day, and the revision is the better
       rule.* "Don't repeat the routine", taken literally, **deletes**: seven identical morning
       routines become zero, and a quiet week compares as an empty table saying nothing at all.
       Raised as "instead of removing everything that's the same (and potentially leaving nothing),
       can we leave the first instance". So a repeat now **collapses** instead — the earliest day
       of a run prints its value, the days after it carry a ditto — and meals and habits are rows
       again, because repetition costs one glyph rather than a column of duplicated text.
    4. **Entry: a COMPARE DAYS button in the shared day block**, so it's reachable from Day, Week
       and Month and seeds with the day you were already on. No new zoom, no new bottom-bar button.
  - **A row no column has anything for is still not drawn** — nothing on every day is genuinely
    nothing, and a ditto can't rescue it. The `SCHEDULE` getter returns `null` rather than `"None"`
    specifically so that rule can fire: three cells agreeing about nothing is noise, not
    information. A row that *repeats* is a different case and collapses rather than vanishing.
  - **The ditto is not a blank, and that distinction is the feature.** A blank already means
    "nothing on this day"; if a repeated `5h 30m` were blanked, one empty cell would mean both that
    and "same as yesterday", which on a BOOKED row is not ambiguity but a wrong answer. It is also
    deliberately sized *up* (17px, `--text-dim`) — the first attempt at 13px `--text-faint` read as
    an empty cell in the screenshot, i.e. as exactly the thing it exists to prevent. A mark standing
    in for a blank has to out-read the blank.
  - **Compared against the left neighbour, not the first column.** For a value that returns after a
    gap (workout on Mon and Wed but not Tue), the third day genuinely differs from the day beside
    it; marking it "same" would point two columns back past a different value. A run keeps its
    first instance either way — this only changes the A/B/A case, and it's the case that reads
    wrong otherwise.
  - A row every day agrees on is kept but dimmed: it is context for the rows that do differ. That
    it is *kept* is the "never leaves you with nothing" property the collapse was asked for.
  - Starting from Day zoom switches to Week, because Day has no grid to pick further days from and a
    selection mode with nothing to select in it is a dead end.
  - Deselecting every day leaves the mode **on**. You're mid-reselection, and dropping out because
    the list hit zero would be the app deciding you were finished.
  - **Capped at 7 (`CAL_COMPARE_MAX`), so a full week fits side by side.** It started at 4 — the
    width at which a phone stops showing everything at once — and went to 7 once the table earned
    the right to be wider than the screen. Two things bought that:
    - **The row-label column pins** (`position: sticky; left: 0`). Without it, scrolling right
      leaves four columns of numbers and no way to tell which row is which. It needs its own
      background or the scrolling cells show through.
    - **Day columns snap**, with `scroll-snap-type: x proximity` — *proximity*, not *mandatory*, so
      it pulls toward the nearest column edge when you let go near one and still lets a deliberate
      scroll to mid-week stay there. `scroll-padding-left` matches the sticky column's width, or a
      snapped column parks underneath it.
    - Still inside its own `overflow-x` box, so the page body never scrolls sideways — asserted.
    - The test measures this rather than reading the stylesheet: it scrolls to 200px, waits, and
      checks the rest position moved *and* that some column's left edge landed on the padding
      boundary. Column widths are content-sized by the table, so asserting a fixed multiple was
      wrong — the first version of that check failed for exactly that reason.
    - Note that a computed `scroll-snap-type: x proximity` serialises as just `x`, since proximity
      is the initial strictness. The assertion that carries meaning is that it is **not**
      `mandatory`.
  - Every row reads from `dayModel()`, so this agrees with Home and the Day view by construction.

- **Calendar and Agenda harmonised; Agenda retired (2026-09-15).** Asked as "weekly view kind of
  shows the same thing — is there a reason to have Agenda?" They weren't the same, and the gap was
  the actual bug: **Week and Month rendered only the selected day's reminders, while Day rendered
  its whole schedule.** One tap, two different answers, and the shallower one was on the two zooms
  you tap days from most.
  - **`renderSelectedDayDetail()`** is now the one block for the selected day — exception control,
    schedule timeline, untimed items, reminders — and Day, Week and Month all render it. A zoom
    owns only its own grid now.
  - **ADD REMINDER leads the block**, above the schedule rather than under it. It's the one thing
    you come to a day to *do*, and on a busy day it sat below a full timeline — reachable only by
    scrolling past the very content you were trying to add to.
  - The day label is suppressed in Day zoom only: the header directly above already names the day,
    and saying it twice was the one thing sharing the block made worse. Week and Month keep it,
    because their headers name a *range*, not the selected day.
  - **Agenda removed** — subtab, `renderAgenda()`, `AGENDA_DAYS`, its CSS and `test_agenda.js`.
    Schedule's bar is HOME/CALENDAR/SETUP, and Home's matches.
    - **What was lost, and how it came back the same day:** the rolling next-7-days view with item
      *names*. Week is calendar-aligned (Sun–Sat, so on a Friday it shows four days already lived)
      and its cells show density, not "Dentist 2pm". ~~Nothing replaces "what's coming up this week"
      at a glance~~ — **Compare days** does, and more besides, since the day set is chosen rather
      than always being the next seven. See its entry above.
  - `NAV.scheduleSubtab` had drifted to a stale default of `'today'`, a subtab that stopped existing
    two refactors ago. It's `'calendar'` now, and `renderSchedule()` treats **anything that isn't
    `'setup'`** as the calendar — this value rides in nav snapshots and has now outlived two of its
    own values, so an unknown one has to land somewhere real rather than render nothing.
  - Four tests referenced `renderAgenda()` as a surface to assert against. They point at
    `renderSelectedDayDetail()` now, which is a *stronger* check than before: it's the block all
    three zooms share, so the structural guards ("no surface re-derives the day behind
    `dayModel()`'s back", "no surface hardcodes a section hex") now cover more ground than the
    Agenda ever did.

- **The midnight test failures: pinned, and guarded against coming back (2026-09-15).** Found by
  running the suite at 00:02 — `test_day_fold.js` failed and looked exactly like a regression from
  the COMPARE work. It wasn't: stashing the working tree and running at HEAD failed identically.
  - **The shape, which is worth recognising anywhere:** a fixture says "now ± n minutes" and clamps
    the result into a valid day (`Math.max(0, …)`, `Math.min(1439, …)`). Near midnight the clamp
    lands it on the **wrong side of now** — five "already passed" blocks all clamp to 00:00, which
    is not passed — so the fixture quietly describes a different day than the one being asserted.
    It fails about twice a year, only for whoever runs the suite around midnight.
  - `test_reminder_past_due.js` had the mirror image, and its comment is a small lesson in its own
    right: the clamp was *added* to fix a 22:36 day-wrap bug, and claimed to do so "without mocking
    Date itself". It traded a late-evening failure for an after-midnight one. Both notes kept.
  - **Fixed with `pinClock(page)`** in `tests/helpers.js` — Playwright's `clock.setFixedTime` at a
    fixed mid-afternoon instant, called before `page.goto()` so boot-time reads see it too. The
    whole page then agrees: the fixture's `new Date()`, `todayStr()` and the renderer's own clock
    are one instant, which is what actually makes these deterministic. `setFixedTime`, not
    `install()`: this app renders through `requestAnimationFrame`, and faking timers would stall
    `render()` and hang `settle()`.
  - Applied to all four clock-reading tests, two of which hadn't failed yet but were one late run
    away: `test_dated_events.js` (a live event built as `now ± 10m` but stamped `todayStr()` — at
    00:05 the start formats as 23:55 *tonight*) and `test_today_schedule_layout.js` (`now .. now+10m`
    wrapped mod 1440 becomes an *overnight* block at 23:55, a different case than it asserts).
  - **The durable part is the guard**: `test_smoke.js` now fails if any test reads `getHours()`/
    `getMinutes()` without an `await pinClock(`. Same principle as the CSS contract test — convert a
    silent, conditional failure into a loud immediate one.
    - First version of the guard was wrong and passed a file I had deliberately broken: it matched
      a bare `pinClock(`, which these files mention *in their comments*. Only caught by deleting
      the real call and watching the guard stay green. **A guard is worth having only once you have
      watched it fail.**

- **COMPARE stops being a lift screen: labs and the daily log chart there too (2026-09-15).** The
  lab-comparison feature, built to the four decisions recorded under Ideas plus two answered while
  mocking it up: the daily-log metrics **moved in**, and charts frame on **data + nearest bound**.
  - **The conversion bug this had to fix first.** COMPARE charted lifts and body weight only, and
    every series was weight-shaped: the draw code read `p.weightLb` and ran it through
    `lbToDisplay()` *unconditionally*. Labs and the daily log break that outright — an HbA1c of 5.4
    is not pounds, and 9,000 steps reported in kilograms would be a straight-faced lie. So a series
    id now resolves to **one descriptor** (`{label, unit, decimals, format, points, bands,
    movementFor}`) and nothing downstream branches on kind. A future source is a new resolver plus
    a line in `compareMetricGroups()`; the chart, the range filter and the summary need no edit.
  - The picker is **grouped by source** (BODY / LIFTS / LABS) — an undivided run of chips gave no
    clue that "Steps" and "ApoB" come from different places. Empty groups are omitted. Labs are
    **offered, not resolvable**: only markers you have readings for, because a picker listing all 32
    would bury the four you track.
  - **The chart frames differently from the bar, on purpose.** The bar shows every stated bound;
    `labChartFrame()` frames on the data widened to the *nearest* bound each side. Vitamin D decided
    it: ref 30–100 with readings 28–52, where showing every bound spends two thirds of the plot on
    range the readings never enter (tested: the chart uses >2× the height the bar does). They may
    differ but must not **disagree**, so the zone walk was extracted to `labZoneSegments(key, lo,
    hi)` and both paint from it — with clamping, since a chart window can legitimately end below a
    stated bound.
  - **The y-axis ticks at band edges**, not round numbers: 80 and 130 are the only values on an ApoB
    axis a reading is measured against, and 100/150 are noise that happen to divide evenly.
  - Range presets fill the date fields (so custom starts from something real); editing either field
    drops the preset chip, because a lit `1Y` next to hand-typed dates it doesn't describe is a lie.
  - The summary is **first-in-range → last-in-range per metric**, which is what makes it work on
    sparse draws: nothing is ever compared *across* series, so no two markers need share a date.
    Direction comes from `labMovement()` — a lift or a step count gets its number and no verdict.
  - Empty states distinguish "never logged" from "nothing in *this* window", since with a range
    control on screen the second is self-inflicted and the fix is different.
  - **Three bugs found by looking at it**, two of them pre-existing:
    - `.tag-pill.active` fell back to `background: var(--tc, var(--surface2))` with hardcoded
      near-black ink, so an untagged selected chip (COMPARE's whole picker) rendered dark-on-dark
      and read as unselected. Fallback is `--accent` now, matching every other selected control.
    - Seven external themes restyle `.tag-pill` and **beat the active state on source order** — the
      exact `.btn`/`.btn-primary` trap CLAUDE.md documents. Their rules are scoped
      `:not(.active)` so the resting look no longer claims the state. *The contract test caught
      this one*, across all 23 themes, which is precisely what it was built for.
    - A fixed y-window hands Chart.js fractional bounds, so a tick stringified as
      `5.8000000000000001 %`. Rounded then stripped — `fmt()` alone removes only a single `.0`.
  - Lab values print **as recorded** (`96`, not `96.00`): a result carries the assay's own
    precision, and padding it invents confidence. The range header always carries the year, because
    `fmtGoalDate()` drops it in the current year and "Jan 1 → Dec 31" names neither one.

- **The "my rule silently lost" CSS family: named, fixed at the source, and put under test
  (2026-09-15).** Prompted by the grey history-delta column. Every member is one failure — a CSS
  rule that didn't apply, with nothing saying so — and it kept recurring because CSS is the one
  layer of this stack with no feedback channel: a bad reference throws, a type error fails `tsc`,
  a losing declaration renders a plausible page. Four shapes, counted from the codebase:
  1. `input[type="text"]` (0,1,1) beating a bare class (0,1,0) — bit three times, left **fifteen**
     `input[type=…].class` selectors written purely to out-rank the base.
  2. `.entry-card .ehead` scoping a reusable row's flex to one parent — **six** redeclarations
     whose comments counted to "FIFTH time", plus **two more in the lifts screens nobody noticed**:
     `.lift-muscle-chip` declared `flex: none` to a parent that wasn't flex, so the chip rendered
     under the name. Found only because the fix made it visible.
  3. A theme at (0,2,0) repainting a component's (0,1,0) — the `--rung` workaround's origin.
  4. `.lab-move-toward .mono` — a descendant selector for classes on the same element.
  - **A. Base form styles now carry zero specificity** via `:where()`. A plain class on an input
    wins the way anyone writing one expects. The fifteen defensive selectors still work; they no
    longer need to exist.
  - **B. `.ehead` lays itself out.** Flex on the class, spacing on the contexts. Five duplicate
    blocks and their counting comments deleted; the two silent lifts victims fixed as a side effect.
  - **C. `tests/test_css_contract.js`** asserts *computed* styles — what the cascade produced, not
    what was written — for 21 contracts under every one of the 23 aesthetics (483 checks). Add a
    contract by appending one entry. Failures are collected, not thrown, and grouped by contract so
    a rule broken under all 23 themes reads as one problem.
    - **It found four live bugs on its first run.** Under all **eleven external themes**, the
      `[data-aesthetic] input` list at (0,1,1) was beating `.lab-filled` (the paste highlight) and
      `.skill-item-name` (the unboxed inline editor); `cartomancer` was also overriding number-input
      fonts. None of it had been seen because nobody switches through eleven themes by hand —
      precisely the case shape 3 hides in. Fixed by extending A into the themes: each generic
      `input/select/textarea` list is now wrapped in `:where()`, with the `.note-editor` class that
      ends every list deliberately left *outside* it so it keeps its specificity.
    - One probe of mine was wrong (select `width` is floored by the base padding, which reads as
      a specificity loss and isn't one) and the wrapping script skipped `y2k` because its key regex
      was `[a-z]+` and the key has a digit — it said "no block" instead of failing. Both corrected;
      both are the kind of thing the contract test exists to catch.
  - **Not done, on purpose: full `@layer`.** It's the textbook cure for shapes 1 and 3, but themes
    *legitimately* override component appearance (`.btn`, `.panel` borders) while component *state*
    (`.lab-filled`, `.skill-target-hit`) must beat themes — and layers can't express "modifiers win,
    base components lose" without classifying all 2,246 lines. After A+B+C the flat file may simply
    stop hurting. The convention is written into CLAUDE.md so the next session inherits it.

- **Lab bars stop starting at zero, and a marker's history opens on tap (2026-09-15).** Both came
  out of looking at the shipped trail: the dots on HbA1c were an unreadable smudge, and the first
  question asked about the bar was what the bold white line was.
  - **The axis is framed on the data and the bands.** It ran `0 → hi`, which spent most of the track
    on values a marker can't have — HbA1c lives between about 4 and 6, so five readings landed at
    79.6 / 81 / 82.5 / 85.5 / 91.7%, all inside 24px of a 325px bar. Now it runs
    `min(bounds, readings) → max(bounds, readings)` with 12% padding: the same five readings land at
    8 / 25 / 42 / 75 / 92%, tightest gap 16% of the track against the ~2.2% a dot occupies.
    - **Safe to drop zero because this bar has no tick labels.** It's a position strip with coloured
      zones and a Ref/Target key underneath; it never claimed the left edge was zero.
    - **`lo` is pinned at or below the lowest stated BOUND, not the lowest reading.** Framing on the
      readings alone would put an ApoB axis at ~86 and push the whole target band (≤80) off the left
      edge. A band you can't see isn't doing its job. Tests assert every band keeps real width.
    - Floored at zero, since no assay reports a negative concentration.
    - **An axis break was the alternative and was rejected**: it's a *chart* convention, and this is
      11px tall with no ticks, so a break glyph would be the first tick-like mark on it — spending
      pixels to signal the absence of a region that was never labelled. Reframing gets the same
      result with nothing added. Also rejected: nudging colliding dots apart (in a positional
      display, moving a mark off its value is the one thing you can't do), and switching axis rules
      only when compressed (two markers on one screen would silently use different rules).
  - **Tap a marker row to open its full dated history** — every reading, not the four the bar draws,
    with per-step deltas coloured by the same band-movement rule. This also answers the limitation
    the dots shipped with: they carry no time axis, so two draws a week apart and two years apart
    render identically. A list has dates in it.
    - **The tap is on the row, not the dots**, which is what was asked for and is the wrong target:
      a dot is 7px against WCAG's 24px minimum, so hit areas big enough to land on would overlap
      their neighbours' — reintroducing the collision problem, invisibly, as "which reading did I
      just tap". A marker with only one reading stays a plain row rather than a control that does
      nothing. Real `<button>`, so it takes keyboard focus and reports `aria-expanded`.
  - **A specificity bug a screenshot caught**, and a new variant of the family: the delta chip puts
    `.mono` on a *child*, so `.lab-move-toward .mono` reaches it. In the history list both classes
    land on the *same element*, where that descendant selector matches nothing — the direction
    colouring went silently missing and rendered a column of grey. Fixed with same-element rules at
    (0,2,0). The test asserts the computed colour rather than the class, since the class was present
    and correct the whole time.

- **The trail: earlier lab readings as fading dots on the same bar (2026-09-15).** Comparison, built
  marker-first for the reason recorded under Ideas: panels are sparse and irregular, so two
  arbitrary draws share a handful of markers, while one marker's own history has no gaps.
  `labHistory(key)` is the function the whole thing rests on, and `latestLabValue()` collapsed into
  its head.
  - **No chart library, no second coordinate system.** `labBarZones()` already returned `pct(v)`, so
    prior readings plot on the bar that was already there. Four dots maximum, fading with age
    (0.8 / 0.6 / 0.4 / 0.2), newest solid. Works from the *second draw ever* — which matters at two
    to four draws a year, where a line chart stays uninformative for years.
  - **The axis trap, and the reason the trail had to change `labBarZones()` rather than sit on top
    of it.** `hi` came from the current value and the bounds alone. ApoB's ceiling is 130 and the
    current reading is 96, so the axis topped out near 150 — and a reading of 180 from four draws
    ago clamped to the right edge, drawing *the single most dramatic improvement in the series* as a
    dot that never moved. The trail is now part of the axis. A test pins that history widens `hi`
    without moving the **bands**, which are fixed numbers and must not drift because data arrived.
  - **Direction is measured against your band, never the raw sign.** Down 14 on ApoB is progress;
    down 14 on HDL is not. `labBandDistance()` returns how far outside your band a reading sits (0 =
    inside), and `labMovement()` compares two of those: `toward` / `away` / `level`. That's
    arithmetic on numbers you typed on the ranges screen, which is the same thing `labStatus()`
    already does for a single reading — not the app forming an opinion about a marker. A marker with
    no bounds stated returns `null` and renders its change as a plain uncoloured number.
  - The delta chip reads against the **immediately previous** draw only. "Since your last draw" has
    one answer; "since when?" across four dots is a question the row has no room to ask.
  - **The current reading became a dot too**, one size up and solid, and the track grew to 11px.
    It had been a tall bold rule spanning the bar, which was right while it was the only thing on
    the track and wrong the moment the trail arrived — a single series rendered as two different
    shapes reads as two unrelated things, and the rule was the first thing asked about on sight.
    Removing it outright was the other option and would have been wrong: the dots are *prior*
    readings, so dropping it takes "where you stand right now" off the panel named WHERE YOU STAND.
  - ~~Known limitation: the zero-based axis squeezes markers whose span sits far from zero (HbA1c,
    creatinine, albumin) into an overlapping smudge~~ — **fixed the same day**, see the axis reframe
    above. Worth noting it was found by *looking at the screenshot*, not by any collision check:
    nothing in the code knew or knows whether two dots touch.
  - My own wrong test expectation, again, and the same marker as last time: WBC states a reference
    interval of 4–11, so two readings inside it are `level`, not "no opinion". An *unbounded* marker
    is a custom one you added, which starts with no bounds at all.

- **Editing a saved lab panel (2026-09-15).** There was no edit path at all — correcting one digit
  meant deleting the panel and retyping every number in it. Survivable while entry was slow and
  manual; the moment a paste could fill fifteen markers at once, one typo costing the whole panel
  became the sharpest edge in the feature, and it got fixed ahead of comparison because of it.
  - Reuses the add form rather than building a second one (`VIEW.labEditing` holds the panel id, the
    same `VIEW.<x>Editing` convention `scheduleBuilderEditing` set). Same markers, same ranges, same
    paste box — pasting *into* an edit is how you replace a hand-typed panel with the real report.
  - **`values` is rebuilt from the form, not merged into.** That's what makes clearing a box remove
    a reading; a merge would leave a mistyped extra marker impossible to take back off the panel.
  - **Two ways that rebuild could destroy data, both handled:**
    - A panel can hold a reading whose custom marker was later **deleted**. Those have no field in
      the form, so a rebuild drops them on save — silently contradicting exactly what
      `deleteCustomLabMarker()`'s confirm promises ("those readings stay but lose their label").
      They're carried across untouched now, and a test pins it.
    - Emptying every box is refused rather than treated as a delete. There's a delete button for
      that and it asks first.
  - The id survives the edit — an edit is the same draw with a number corrected, not a replacement.
  - A stored value deliberately does **not** get the accent border a pasted one gets: that border
    means "machine-read, check me", which a number you typed yourself last March is not.

- **Pasting a lab report (2026-09-15).** Bulk entry was the real friction left in labs: a report is
  routinely fifteen numbers, and typing fifteen numbers into fifteen boxes is where the feature
  stops getting used. Four approaches were on the table, including sending the report to Claude.
  **The local paste-parser won, and the reason is worth keeping:** lab results are the most
  sensitive data this app holds, sending them anywhere departs from its local-first posture, and a
  regex clears the job. It's also the cheapest way to *find out* whether a model is needed — ship
  the dumb version, see what it can't read.
  - `parseLabText(text)` walks the pasted lines, matches the longest known marker name or alias, and
    takes the first number **after** the name. It returns what it matched *and* what it didn't,
    because a parser that silently mis-fills medical numbers is worse than no parser at all.
  - **Most of the work is refusing to guess.** Three false positives the tests pin, all of which
    produce a plausible-looking wrong number rather than an obvious failure:
    - `Cholesterol/HDL Ratio 3.1` names two markers and carries a number belonging to neither —
      without `LAB_SKIP_LINE` it records total cholesterol as 3.1.
    - `Vitamin D, 25-Hydroxy 46` and `Vitamin B-12 512` carry digits *inside the name*; reading
      left-to-right gives vitamin D as 25 and B12 as 12. Hence numbers only after the name.
    - A bare `hdl` would otherwise claim the `Non-HDL Cholesterol` line, so candidates are matched
      longest-name-first. First mention in the document wins, so a footnote can't overwrite a result.
  - **It fills the form; it never saves.** The parse writes to `VIEW.labPasteDraft`, filled fields
    render with an accent border so what still needs checking against the paper is obvious, and
    `saveLabPanel()` is untouched — an edited field beats the parsed value, and ignoring the feature
    entirely changes nothing.
  - **The subtle bug worth the note:** `saveLabPanel()` reads only the *offered* markers, so a paste
    matching something outside the core panel would have filled a row that never renders and been
    dropped on save. The draft now joins `offeredLabMarkers()` the same way a saved reading does —
    the resolve-vs-offer split, load-bearing for the fifth time.
  - The draft dies with the form. Unlike a half-built meal, a pasted draft that survived navigation
    would come back pre-filled with medical numbers whose origin you've forgotten.

- **Sleep, steps, resting heart rate and blood pressure charted on the Body tab (2026-09-15).** From the "Best Shape
  of Your Life" scope, ranked #2 — the cheapest win in it. `WEIGHT_METRICS` charted only
  weight/body fat %/body water %, while sleep hours, sleep quality and steps were already logged
  daily via Home's quick-log chips and went straight into a hole. Resting heart rate is new.
  - **The two sources were genuinely different shapes**, not just different fields: `STATE.weightLog`
    is an array of dated entries, `STATE.life.dailyLog` is an object *keyed* by date. Generalized via
    one `metricSeries(metric)` in `app-body.js` that resolves either into the `{date, value}` list
    the chart and `trailingAverage()` already expect — a metric carries `source`, `get()` and
    `has()`, and drawing code never needs to know which kind it's looking at. No test had ever
    existed for this chart, weight-only or otherwise; `test_body_metrics.js` is new and pins the
    sort order surviving unordered object-key insertion, per-field filtering (a day with sleep but
    no steps logged must drop out of the steps series only), and the empty-state copy — which had to
    stop pointing "at the log below" for `dailyLog` metrics, since there isn't one there.
  - **Resting heart rate got a new AM chip** (checked on waking, same moment as sleep), taking the
    AM strip from 3 chips to 4. Screenshot-checked at 390px before shipping — the grid held up fine;
    the label reads `REST HR` to keep it on one line at that width.
  - **Blood pressure followed immediately, and the objection to it was wrong.** It was scoped out as
    "two numbers, not one, and nothing here has a hook for a paired value" — but the water chip has
    read `1250/2000` off a pair since it was built, so the display precedent already existed and had
    simply been overlooked. Added as one FIELD with two stored parts (`bpSystolic`/`bpDiastolic`),
    not two fields that have to be kept in step.
    - **A reading is the pair.** `logFieldValue('bloodPressure')` returns an object or null, and
      blanking either half clears BOTH — a stored lone systolic would render as `118/` on the chip
      and put a point on the chart the other line couldn't match.
    - **The chart gained `parts` rather than a special case.** A metric with `parts` draws one line
      per part and skips the trailing average (two lines plus two averages is four lines saying very
      little); everything else is untouched. Both lines come off the *same* date list, chosen once by
      `metric.has()`, so they can't drift apart on the x-axis — which is what `metricSeries(metric,
      get)`'s optional getter override exists for.
    - Unlike water there's no meaningful zero, so an unlogged day is a dash rather than `0/0`.

- **Practice on the weekday plan (2026-09-15).** Step 6 of "Skills Own the Ladder" — the last, and
  the only one that reshaped a primitive other features read. Shipped in two commits: the shape
  alone, then the feature.
  - **Step 1, the conversion, deliberately alone.** `{id, workoutId}` → `{id, kind, refId}` across
    the global plan and every block's private copy, with the suite expected to pass untouched.
    Eight test files broke, and all eight were fixtures writing the old shape straight into
    `STATE.exercisePlan` *after* load — bypassing the migration. They go through `planEntry()` now.
    The grep also missed a site: `deleteWorkout()` filters plan entries, in `app-state.js` rather
    than any of the four files the survey named. Sixteen touch points, not fifteen.
  - **`exercisePlanInEffect()` needed no change at all** — the 200 lines of phase, active-rest,
    deload and carried-plan resolution. It decides *which* plan governs a date and never opens an
    entry. That was most of the feared blast radius, and it wasn't real.
  - **Why not a second nullable `skillId`:** half the edits and no migration, but two nullable fields
    where exactly one is ever set *is* a discriminated union with the rule living in a comment. That
    shape is what the Skill model spent a fortnight removing; it doesn't come back to save an
    afternoon. `migrateWeekPlanEntries()` is the only function allowed to know the old field name,
    and the test asserts `e.workoutId` appears there and nowhere else.
  - **Step 2, the feature.** A `kind: 'skill'` entry with optional `minutes`, because a workout
    carries its own content while the block builder can't pick anything without a budget. The
    Planner picker gained a Practice group and now returns `"kind:id"` (a workout id and a skill id
    are both uids; nothing about either says which list it came from). Switching an entry's kind
    drops minutes rather than leaving a number on something that can't use it.
  - **`dayModel()` gains its own `practice` list** rather than folding skills in with workouts: the
    two open different screens and are done differently. Tapping opens the skill's practice starter
    and does NOT start a block — starting one commits a budget and builds around it, which is more
    than one tap from a day card should do. The starter *looks up* the planned minutes rather than
    being handed them, so the number is right however you arrived and there's no transient
    "where did you come from" state to keep in step.
  - **`weekPlanWorkoutCount()` became `weekPlanCount()`**, counting workouts and practice separately:
    a training block reporting a guitar session as training volume would be wrong.
  - **An archived skill still renders on the plan**, marked as archived. Archiving keeps it
    resolvable on purpose, and silently dropping a day you'd committed to would be the app deciding
    rather than reporting — one of the three questions the scope left open, answered that way.

- **Skill targets (2026-09-15).** Step 5 of "Skills Own the Ladder", and the last before the weekday
  plan. New file `src/app-skill-targets.js`, new `STATE.skillTargets`, a TARGETS subtab.
  `{id, skillId, kind: 'items'|'minutes', listId, rung, count, byDate, createdAt, reachedOn}`.
  - **A skill target can go BACKWARDS, and an exercise target can't.** That's the one real difference
    and the whole design turns on it: once 225 has been on the bar it has been on the bar (hence
    `.ex-target-hit` turns green and stays), but an item's rung is *derived* from its interval, so a
    bad rating collapses it. "3 songs at PROFICIENT" can be true in October and false in December.
  - **So `reachedOn` is stamped, not recomputed.** The tick is permanent — you did hit it — and the
    live count appears beside it whenever it has since slipped: *"reached 25 Aug · 2 of 3 right
    now"*. Hiding a real regression to protect a tick would be the app flattering you; dropping the
    tick would deny something that happened. Minutes targets can't slip, and aren't checked for it.
  - **"Or better" is an index comparison** against the ordered ladder, so a MASTERED song counts
    toward a PROFICIENT target — it passed through proficient on the way. `'new'` isn't offered as a
    target rung: "3 songs at NEW or better" is every song in the list, a target you clear by typing.
  - **Minutes count practice you LOGGED**, in the window from `createdAt` to `byDate`. Deliberately
    *not* the week rollup's de-duplicated figure, which adds scheduled blocks you never logged
    against — reproducing that here would mean scanning the schedule for every day of the window on
    every render, ninety passes for a three-month target. The copy says "practice logged" so the two
    numbers can't be confused.
  - **`byDate` is optional.** A standing ambition is a legitimate target; a date turns it into a
    deadline. Overdue is reported and never enforced — the target stays, it just says the date passed.
  - **Stamping happens at the three places progress can RISE, and that list is exhaustive rather than
    hopeful:** a rung only rises through `applySkillRating()` (finishing a session) or by claiming
    mastery, and minutes only rise by logging a session. Editing a name or tier can't raise a rung;
    adding an item adds a NEW one, rank 0, which can't lift an "at proficient" count; deleting only
    lowers, and lowering never un-stamps. Doing it there rather than lazily inside
    `skillTargetProgress()` keeps the read-out a pure function — a renderer that writes to STATE
    works right up until two of them run in one frame.
  - Inherits the **no-projection** rule outright. Learning moves in steps and stalls exactly as
    strength does, and a straight line through it would be confidently wrong.

- **Per-skill time categories (2026-09-15).** Step 4 of "Skills Own the Ladder". Each skill emits
  its own time category (`skill:<id>`) with its own name and colour, so guitar time and language
  time separate instead of both landing in one HOBBIES bucket.
  - **The seam already existed.** `timeCategories()` (resolve) vs `timeCategoryChoices()` (offer)
    was built for the retired `health` category; skills are the second feature to need it and slot
    straight in — resolve from `allSkills()`, offer from `activeSkills()`.
  - **HOBBIES stays**, against the original scope, which had it retire. A hobby that isn't a tracked
    Skill — a film, a garden, a bike — would otherwise have nowhere to go, and making someone create
    a Skill just to tag an hour is backwards. Skills are an addition to the list, not a replacement.
  - **Deleting became archiving.** `archived` has been on the model since the Skill model shipped and
    `activeSkills()` has filtered on it the whole time; this is the first thing to set it. A skill
    emits a category that schedule blocks out in the calendar point at, so deleting it outright would
    strip the label off real logged hours living somewhere else entirely. Delete still works and now
    says how many blocks it would orphan.
  - **Logged practice feeds the rollup, de-duplicated per day.** Without it the feature would be
    near-useless: you run a 25-minute block with the focus timer and the chart shows nothing unless
    you *also* put a Guitar block on the schedule. Whatever the schedule already claims for that
    skill that day is subtracted first — a 30-minute block plus a 25-minute session is 30 minutes,
    and a 45-minute session against it adds only the 15 that overran. Overlapping *blocks* still each
    count their own duration; that's two things sharing a clock, where this is one thing described
    twice.
  - **`registerSkill()` assigns the colour, not `defaultSkill()`.** Caught in the screenshot pass:
    three skills came out identical because "least used among existing skills" only has an answer at
    the moment a skill JOINS the list — build three before pushing any and all three see the same
    empty list. Every creation path goes through the one function now.
  - The palette reuses the Notes colours rather than inventing a thirteenth set, ordered so the first
    six avoid every hue a Home section already spends — they share the same chart.

- **Guitar becomes a real skill (2026-09-15).** Step 3 of "Skills Own the Ladder". New file
  `src/app-skill-templates.js`: `SKILL_TEMPLATES`, the create-from-template flow, and the one-time
  carry-across. The three hardcoded catalogue screens, `NAV.guitarSubtab`, `setGuitarSubtab()` and
  the five-button guitar strip in the tabbar all retire here — 187 lines out of `app-hobbies.js`,
  which is now the Longevity screen and nothing else.
  - **The index mapping was read once and never again.** `g.chordStatus[3]` meant "whatever sits 4th
    in `GUITAR_CHORDS` today", with three status maps and two date maps and nothing guarding any of
    it. This was the last moment that correspondence was provably correct, since the catalogues
    hadn't changed since launch. After the walk, items carry their own ids and the parallel
    structure is gone for good.
  - **"Learned" maps to PROFICIENT, not EXPERT**, and that's the judgment call worth defending. The
    ladder defines PROFICIENT as "can do it, still needs attention" and EXPERT as "reliable, out of
    every session". The old model had no rating, no interval and no ease — nothing in it could tell
    "played it right once" from "have it cold" — so it cannot support a claim about reliability.
    PROFICIENT is the highest rung the old data honestly reaches, and one clean session lifts it.
    The test pins this, because it's exactly the kind of thing a later refactor would "fix" upward.
  - **Everything carried across is due at once.** The mapping is a guess; one honest rating is data.
    `lastPractised` takes the recorded learned date where there is one, which means a chord learned
    eight months ago correctly reads as STALE straight away — that falls out of the model rather
    than needing a rule. Techniques had no date map at all (the old bug that kept them off their own
    timeline) and join the rest on the migration date.
  - **`STATE.life.guitar` is NOT deleted.** The screens retire; the data stays exactly where it was,
    so a mapping that turns out wrong can be redone against the original rather than reconstructed.
    A `migratedToSkill` stamp makes it run once — set even when there's nothing to carry, so someone
    who starts guitar *after* this ships isn't migrated out from under their real Skill later.
  - **A fresh install gets no Guitar skill it never asked for.** Only a save with actual progress is
    migrated; everyone else finds the template under "+ ADD SKILL".
  - Two things the screenshot pass caught: `detail2` had been stored since day one and rendered
    nowhere (it holds a chord's "Open minor" and a song's genre), and the detail field was an
    `<input>`, which silently clipped the migrated descriptions — the old guitar screen wrapped them,
    so that was a regression on exactly the content being migrated. It's a two-row textarea now, with
    `field-sizing: content` as progressive enhancement rather than measuring `scrollHeight` per item
    on every render, which would be 39 forced reflows on a migrated guitar list.

- **Skills: practice is visible before you open a skill (2026-09-15).** Step 4 of "Closing the
  Loop", and the last of it. The finding that prompted it: **no file outside the two skill files
  called `allSkills()`, `activeSkills()` or `skillById()` at all.** The engine could answer "3 items
  due" for any skill instantly and nothing anywhere asked it — the skill row showed minutes
  practised this week, which is history, and said nothing about what was waiting. A system that only
  tells you what's due after you've decided to practise has the causality backwards.
  - Each row now carries **one flag** beside the name: `3 DUE`, `1 STALE` or `1 STUCK`. One and not
    three, because a row is a glance and three competing counts on it is a dashboard nobody reads.
  - **Priority order is stale → due → stuck.** Stale outranks due because it means real *time* has
    passed rather than sessions, which is the one thing the session counter can't notice on its own;
    stuck comes last because it's a diagnosis rather than something waiting. A skill with nothing
    waiting carries no flag at all.
  - **Deliberately not a Home tile or a notification.** Step 6 of the original scope (practice on the
    weekday plan) is the real integration and the only step that reshapes a primitive other features
    read; this is the cheap independent half and shouldn't pre-empt that design.

- **Skills: the ladder becomes legible (2026-09-15).** Step 3 of the "Closing the Loop" punch list.
  The engine computes a phase, a weight, a floor, an interval, a due countdown and an ease for every
  item; the card showed a rung badge and nothing else, so when something didn't come up in a block
  there was no way to find out why.
  - **A schedule line on every item card**, leading with the plain-English half because "due in 3
    sessions" is the question people actually have: `due in 12 sessions · 7 reps · ease 2.65 ·
    last Sep 6`. A never-practised item says only "never practised" — reps and ease it doesn't have
    yet would be noise, not information. A mastered one says "retired".
  - **`stuckSkillItems()` finally has a caller**, which was the condition for keeping it: code with
    no caller either earns a surface or gets deleted. A STUCK badge on the card, and a FIGHTING YOU
    section on PROGRESS listing every item pinned at the ease floor. `skillItemIsStuck()` was split
    out so the badge and the list share one predicate.
  - It lives on **PROGRESS rather than beside the practice starter**: it's a diagnosis, not something
    to act on mid-session, and stuck items can be spread across several lists — a per-list filter
    would hide half of them. It names them and stops, the same posture as READY TO MASTER. Absent
    entirely when nothing is stuck, since an empty "fighting you" panel is a measurement where there
    is nothing to measure.
  - STUCK is deliberately **not a rung**: it's orthogonal to how far along an item is, so it gets its
    own hue rather than a place on the ladder. A stuck EXPERT is still an expert.
  - A never-practised item can never read as stuck — it isn't fighting you, you haven't met it.

- **Skills: confirm the moves before they commit (2026-09-15).** Step 2 of the "Closing the Loop"
  punch list, and the resolution of the undo question rather than an answer to it.
  - **FINISH opens a summary; it no longer commits.** Every rating is re-tappable right up to that
    point, so it's the last moment nothing has happened — which makes it the moment to show what
    you're about to do. One row per rated item: `EXPERT → LEARNING · every session`, a stripe down
    the edge (green for a rung gained, red for one lost, neutral for one repeated), the verdict
    chip, and BACK / CONFIRM & LOG.
  - **This replaces undo, and is strictly better than it.** A wrong rating is caught at the moment
    it would do damage rather than repaired after, and nothing has to be unwound because nothing has
    yet happened. Undo would have turned the practice log into a transaction journal. (The premise
    that prompted it was also wrong: a mis-tapped FINISH is *self-healing* — unrated items sit at
    `dueIn: 0` and the countdown floors at zero, so they're simply still due next session.)
  - **`nextSkillItemState()` is pure; `applySkillRating()` is now a thin mutating wrapper.** The
    summary previews from it and the commit applies it, so the two can never disagree. Two
    implementations of the same table would drift, and the drift would be invisible until it had
    already moved someone's intervals.
  - **Mastery is offered where you earn it.** You cross interval 20 mid-block; offering it only in
    the item list meant offering it three screens from the session that earned it. Recorded as an
    INTENT on the block and applied at commit, so the summary stays a place where nothing has
    happened yet.
  - **The log entry records what the session DID, as one structure.** `itemIds` becomes
    `moves: [{itemId, rating, spentSec}]` — a list of ids beside a map of ratings beside a map of
    minutes is the same parallel shape the Skill model exists to avoid, and a log entry is no more
    immune to it. `spentSec` comes from the focus timer, so this is also the first record of what a
    block cost rather than what it planned. `itemIds` had no readers in app code, so nothing was
    kept for compatibility's sake.
  - Direction needs both rank AND interval: two ratings can leave an item in the same band and still
    move it (reps 1 → 2 is LEARNING either side), so "unchanged" means genuinely unchanged. And a
    never-practised item rated AGAIN still reads as a gain — NEW → LEARNING is entering the ladder,
    not falling down it.
  - **Fifth time for the `.ehead` trap** (see `.phase-card`, `.ex-target`, `.skill-item`): its flex
    layout is scoped to `.entry-card .ehead`, so the verdict chip dropped onto its own line until
    `.skill-move .ehead` declared its own. Also caught in the same screenshot pass: the verdict chip
    was coloured by the item's *band*, so two GOOD chips rendered differently depending on the rung
    underneath them. It's coloured by the rating now, matching the four buttons in the runner.

- **Skills: nothing lies, nothing is lost (2026-09-15).** Step 1 of the "Closing the Loop" punch
  list, which audited what steps 1-2 actually shipped. Three defects, all in one seam -- what
  happens when the world changes underneath a block that's open on screen.
  - **The finish toast counted taps, not applications.** `finishSkillSession()` reported
    `rated.length` while the loop below it skipped any item deleted mid-session, so it could claim
    three items rated when it moved two -- and wrote those ids into the practice-log entry, leaving
    a dangling reference. It now reports what actually moved.
  - **Deleting an item, list or skill ignored the open session.** Nothing crashed: the runner
    rendered an empty string where the card had been, so you got a silent hole you couldn't explain.
    `dropFromSkillSession()` removes the entries, recomputes the overflow offer (its numbers were
    the floors of items that no longer exist), clears the session if nothing is left, and says so.
  - **`extendSkillSession()` had a button and no test** -- the one path that rebuilds a block while
    ratings already sit on it, and so the one place a rating could silently vanish. Now covered.
  - **The WIP read-out earns its keep.** Decided rather than assumed: exceeding the limit stays
    unscolded, because adding items can't trip it (a new item is reps 0; the limit counts Phase A)
    and the only route past five is several Phase B items lapsing at once -- not something you
    chose. Instead the read-out reads "Learning 8 of 5" in the warning colour and the panel names
    the figure that makes it actionable: the summed floors of everything due, i.e. what it would
    actually take. **Capped at one hour**, and not arbitrarily -- Baddeley & Longman (1978), the
    study the two-dial taper already rests on, found one hour a day the most efficient per hour
    invested, with longer massed sessions retaining worse. The same finding that spaces the items
    bounds the session. Past that the panel says some will wait, which is what deferral is for,
    rather than naming a number that would make the practice worse. A suggestion only: the input is
    never capped, because the app doesn't overrule you about your own practice.
  - **Two time figures, because they mean different things.** The one above is today's: what the due
    list costs once. The second is the STANDING cost -- `skillStandingMinutes()`, the floors of
    everything in Phase A. A Phase B item due today is a one-off (practise it and it's gone for
    three sessions, or eight, or twenty); a Phase A item comes back every single session by design,
    which is the density the cognitive stage wants. So its floor is a recurring commitment, and that
    is what being over the ceiling actually costs. "Learning 12 of 5" is a fact you can shrug at;
    "about 60 min of any session until they graduate" is the same fact in the unit you'd decide in.
    The line is omitted entirely when Phase A is empty -- a zero there would read as a measurement
    rather than an absence.
  - **A voluntary focus timer on each item.** The per-item minutes were a plan the app never
    observed; tapping them now runs a countdown that chimes, and banks the elapsed time -- the first
    record of what a block actually COST rather than what it planned.
    - **Deliberately not a lock**, which was the original proposal. Trapping you on one item until
      its minutes run out is textbook BLOCKED practice, and Shea & Morgan (1979) -- already
      load-bearing here -- found blocked beats random practice *during* a session and loses to it on
      retention and transfer, most strongly for related tasks in one class, which is exactly what an
      item list is. The block builder interleaves on purpose; a lock would quietly undo that. A lock
      also can't create attention, only refuse to record something, while reliably obstructing an
      item that needs three minutes today, cramping hands, and A/B-ing two items against each other.
    - Guadagnoli & Lee's challenge point framework (2004) is the honest counter -- genuine novices
      can be overwhelmed by interleaving and do benefit from more blocking early. Noted rather than
      built, and if it is ever acted on it should be phase-dependent (blocking for reps 1-2, the
      cognitive stage) rather than global. The model already encodes that distinction.
    - **Stored as an END TIME, not a counter.** A ten-minute timer will be backgrounded -- the normal
      case, not the edge case -- and `setInterval` is throttled or suspended while a phone sleeps, so
      a decrementing counter drifts exactly when it matters. The rest timer counts down and gets away
      with it only because it runs for ninety seconds.
    - Ticks by patching its own element once a second (`paintSkillTimer()`), never `render()`, which
      replaces `#app`'s innerHTML wholesale and at 1Hz would rebuild the block and drop focus out of
      the notes field mid-typing. Started/stopped from `_doRender()`, same shape as the subnav
      affordances. Survives `extendSkillSession()`, since mid-item is exactly when you'd take that
      offer.

- **Skills: the practice session and the ladder (2026-09-15).** Step 2 of 6. New file
  `src/app-skill-session.js` — block building, the two-dial taper, the WIP limit, weighted time
  allocation, AGAIN/HARD/GOOD/EASY, and the session runner. `tests/test_skill_session.js` asserts a
  whole practice history in one pass; the engine is pure arithmetic over the model, so most of it
  needs no clicking.
  - **Two dials, not one, driven by one `reps` counter.** Phase A (reps 1–4) keeps an item in
    *every* session while shrinking what it costs (weight 4→3→2→1); Phase B (5+) starts only once
    the cost is at the floor, and opens the gap on the usual multiplier. A flashcard has no
    duration, so classic SRS only ever has the second dial — here every item spends minutes from a
    fixed budget, which is a lever the card model doesn't have. It also fixes an allocation problem
    the interval-only draft had: a seventh item used to force everything else to shrink.
  - **The floor and the proportional split are in direct contradiction** — 12 mature items plus one
    new one wants 31.5 minutes of a 30-minute session. Resolved by *water-filling*: anything whose
    proportional share falls under its floor is pinned at the floor, its minutes come off the top,
    and the rest re-divide what's left. Terminates in at most n passes, and the test asserts it at
    exactly the sizes where the naive split breaks.
  - **Four layered mechanisms for an oversubscribed block,** in the order they act: the WIP limit
    (5 Phase A items per skill) *prevents* it; floors that vary by phase (5/3/2 min) shape it;
    deferral with a priority bump catches the rest (`deferrals` on the item, so nothing starves);
    and a real shortfall earns one line offering to extend — an offer, not a modal, same register
    as the calorie drift's USE THIS / KEEP MINE. Squeeze/Rotate/Pin/Grow are kept on the shelf.
  - **The test caught a real design violation.** HARD was multiplying the interval like every other
    rating, so "that was a struggle" bought you a *longer* break from the item — backwards, and
    contrary to the spec's "same time, same gap, another go". Only an advance up the rep table
    opens the gap now.
  - **A lapse halves `reps` and caps back into Phase A.** SM-2 sends a failed card to zero, which
    asserts you know nothing about it; for a motor skill that's false, because relearning is
    reliably faster than initial learning (the savings effect). Halving alone left items above rep 8
    still in Phase B, which contradicts what a lapse means, so it's capped — costing nothing, since
    one clean session takes rep 4 straight back to 5.
  - **"Stuck" comes out for free:** `stuckSkillItems()` is a filter on ease ≤ 1.3, no model
    required. It's the natural hook for an "ask why I'm stuck" button later.
  - The in-progress session lives in `STATE.skillSession`, not `UI` — it spans real minutes at a
    guitar, and a reload or a backgrounded phone must not lose it. Ratings are held on the *block*
    until you finish, so a mis-tap is one more tap rather than an interval to unpick.

- **Skills: the model and its screens (2026-09-15).** Step 1 of "Skills Own the Ladder" —
  Hobbies stops being guitar-only. A **Skill** is a name, any number of **lists**, and a practice
  log; a **list** holds **items** (tiered under TIER headings, or one flat run). New file
  `src/app-skills.js`, new `STATE.skills`, `.skill-*` styles, `tests/test_skills.js`.
  - **Progress lives ON the item, keyed by its own id.** The guitar catalogues key status by
    **array index** into a shipped constant (`g.chordStatus[3]` = "whatever is 4th in
    `GUITAR_CHORDS` today"), so inserting or reordering one chord silently shifts every status
    after it onto the wrong item, with nothing guarding it. Same reasoning as the lift library, and
    the test reverses a list and re-asserts every rung to keep it that way.
  - **The ladder is derived, not stored.** `skillItemBand()` reads NEW / LEARNING / PROFICIENT /
    EXPERT off `interval`, so a bad rating collapses the interval and the rung follows it back down
    with no bookkeeping. `mastered` is the one stored rung, because it's a claim you make.
    EXPERT is open-ended (≥5) rather than a closed 5–6 band: at ease 2.5 the intervals land only on
    0 → 1 → 3 → 8 → 20 → 50, so nothing would ever sit in a closed band. Mastery is *offered* at 20.
  - **A skill's lists live in the in-screen `.subnav`, never the bottom `.tabbar`.** A skill can
    have any number of them, and `.subnav` is the strip with the scroll-chevron affordances while
    `.tabbar` is the one with the logged overflow bug (still open, below).
  - **Guitar is untouched and still reachable**, from a dashed LEGACY row on the skill list, with
    its way back rendered *in-screen* so its five-button strip doesn't push the bar to seven. It
    becomes a real skill, with its progress carried across, at the next step.
  - Items carry `reps`/`ease`/`interval`/`dueIn` from day one and nothing writes them yet — the
    session engine (block building, the two-dial taper, AGAIN/HARD/GOOD/EASY, the WIP limit) is
    step 2. `loadState()` backfills them, so a skill saved before that lands needs no migration.
  - **Cost a repeat of a documented trap:** the base `input[type="text"]` rule is (0,1,1), so every
    bare-class inline-edit field rendered as a boxed form input until rewritten as
    `input[type="text"].skill-item-name` — exactly what the comment on `.phase-label` warns about.
    The rung colour is a single inherited `--rung` custom property for the same class of reason:
    several aesthetics restate `.panel`'s `border-color` at (0,2,0) and would repaint a left border
    out from under it.

- **Fixed: the retired HEALTH & DIET tile survived in saved Home layouts (2026-09-14).** Reported
  from a phone screenshot showing five tiles — FITNESS *and* HEALTH & DIET side by side — the day
  after the merge shipped.
  - **Fresh installs were fine, which is why the whole suite passed.** `defaultHomeLayout()` had
    already dropped `health`. But a **saved** layout still named it, and `migrateState()`'s stale-id
    guard (`filter(id => HOME_SECTION_META[id])`) cannot drop it — the entry deliberately survives
    so meal link chips keep their colour. It has to be filtered **by name**, exactly as `schedule`
    already was, and the comment on that line spelled out this very hazard.
  - **Tapping it didn't just look wrong, it stranded you.** `health` has no render branch, and
    `switchTab()` to a branchless tab doesn't blank the screen — it leaves the *previous* screen's
    markup up while the bottom bar loses its section buttons. Reads as a frozen app. `MERGED_TABS`
    now redirects it to `train` in `switchTab()`.
  - **`schedule` is deliberately NOT redirected**, and conflating the two broke Home's bar on the
    first attempt (caught by `test_home_bar.js`). It's still a live tab `goSchedule()` navigates to
    on purpose — only its *tile* retired. Two separate constants now: `RETIRED_SECTION_TILES` (no
    Home tile, not a landing page) and `MERGED_TABS` (no render branch, redirect to where it went).
  - **The test gap:** `test_home_bar.js` had a thorough table of saved-layout migration cases from
    the schedule retirement, and every one still expected `health` to survive — the merge never
    updated them. `health` is folded into that table now, plus a case for a retired id reaching
    `switchTab()` anyway.
  - The WORKOUTS screen still titled itself "Exercise" while every other screen in the tab said
    "Health & Fitness". Fixed in the same pass.

- **Renamed "Health & Fitness" to "Health & Wellness", and gave it its own icon (2026-09-15).**
  Every user-facing occurrence (four `section-title`s, the cross-references under GOAL/Longevity/
  the TDEE panel) now reads "Health & Wellness"; internal identifiers (`fitnessSubtab`,
  `renderFitnessSetup()`, `MERGED_TABS`, the `train` tab id itself) are untouched, same discipline
  as `budget`/"FINANCIAL" already diverging. The Home tile's `wellness` icon is the `exercise`
  barbell scaled to 0.6 and re-centred inside the `health` heart's rounder upper body — verified in
  isolation before wiring in, since the heart narrows to a point toward the bottom and a naively
  centred barbell would have overflowed the outline. Tile label follows: FITNESS → WELLNESS. The
  entry below is left as shipped and named at the time; this is the addendum, not a rewrite.

- **Health & Fitness: Exercise and Health & Diet merged into one tab (2026-09-14).** The one item
  "Phases Own the Plan" deliberately left open — *"worth doing after this lands and the seams are
  visible, not before."* No new capability; a restructuring of navigation around splits that were
  always there.
  - **The seam, concretely.** Weight entry lived in Health → Specs while its chart lived in
    Exercise → Progress — the same rows of the same array, two tabs apart. Same for measurements.
    **BODY** now puts each log directly under its own chart. The block card that read *"Edit it in
    Train → Setup → Planner"* no longer sends you to a different tab.
  - **Six subtabs where there were eight across two tabs:** GOAL / WORKOUTS / BODY / DIET /
    LONGEVITY / SETUP, opening on WORKOUTS. SETUP holds the workout and meal libraries as two
    **panels** rather than as two tabs' worth of separate Setup screens.
  - **Reuse the leaves, replace the roof.** `trainTopSubtab` + `healthSubtab` → one `fitnessSubtab`;
    `progressSubtab` → `bodySubtab` (same five values, two renamed for what they now hold); one new
    `setupPanel`. `setupSubtab` and `healthSetupSubtab` were left **completely untouched** — the leaf
    concepts didn't change, only what sits over them.
  - **`HOME_SECTION_META` keeps its `health` entry** even though the tile is gone, because
    `LINKABLE_TYPES` colours meal chips from it — the identical hazard, with the identical fix, that
    the `schedule` retirement already documented in that file. `test_home_bar.js` now asserts both
    retirements, and that meal and workout chips stay visually **distinct**.
  - **`timeCategories()` split in two.** A retired section still has to *resolve* — time already
    tagged `health` keeps its label and colour — but must stop being *offered*, or you'd see two
    names for one section. Dropping the id outright would have silently stripped the tag off real
    logged time.
  - **`initialTab()` needed `health` added to its dead-tab guard.** Its own comment predicted this:
    migrations run *after* NAV's declaration, so migrating `defaultPage` alone still boots you onto
    the dead tab. That exact bug was caught once before by `test_home_bar.js`.
  - **Eleven stale cross-tab pointers in user-facing copy** were repointed or deleted — including
    one under the weight log reading *"See the trend over time on Exercise → Progress → Body
    Weight"*, which after the merge pointed at the chart three inches above it. Found by looking at
    the screen, not by grep.
  - **`test_smoke.js` was passing vacuously.** `switchTab()` to a tab with no render branch leaves
    the *previous* tab's markup in `#app`, so "non-empty" and "NAV.currentTab is what I set" both
    still held — it reported `health: 11993 chars`, byte-identical to the `hobbies` line above it.
    It now asserts each tab renders something **different** from the one before.
  - `renderSpecs()` is gone: it existed only to stack the two logs together, and BODY puts each one
    under its own chart instead.

- **Active rest, phase lines on the charts, and COMPARE on the lift library (2026-09-14).** Steps
  9-11 — the last three of "Phases Own the Plan", all small. **The scope is now fully built.**
  - **Active rest is not a light workout — it's the absence of one.** Walking, an easy bike, a
    kickabout: nothing that counts as a workout, nothing that raises a sweat. So the light-activity
    weeks carry **no exercise plan at all** rather than a heavily reduced one, and anything you do
    logs as an ordinary cardio session — already how a walk gets recorded.
  - **It leads a block, its length is yours, and it isn't uniform.** Week 1 is a *genuine deload of
    the outgoing plan* — you re-sensitise from what you were actually doing, not from the block that
    hasn't started in earnest yet — with the remaining weeks light. That ordering is the point:
    dropping straight to nothing skips the step that does the work. Capped below the block's own
    length, because a block that is entirely active rest isn't a block.
  - **The whole span eats at maintenance**, not just its deload week. `dateIsMaintenanceWeek()` is
    the rung `calorieTargetForDate()` reads; running a deficit through light activity wastes it the
    same way it wastes a deload.
  - **Nothing warns about accumulated volume**, and that's deliberate. Overreaching late in a
    hypertrophy block is the *plan* — you push past sustainable volume precisely because a deload and
    active rest are coming. The app instruments the plan; it doesn't second-guess it.
  - **Phase lines on the charts** (`phaseBoundaryPlugin`), on body weight, body measurement and every
    COMPARE chart. These use a **category** x-axis, not a time scale, so a boundary is mapped to an
    index and snapped to the first logged point at or after it — a block can start on a day you
    didn't weigh in. Labels stagger onto two rows by goal kind, since the two timelines are
    independent and regularly start on the same day, and any label that would collide is skipped.
  - **COMPARE now reads the lift library**, which makes RP-style exercises and T3 accessories
    chartable for the first time — the picker could only ever see T1/T2 category slots. Added
    *alongside* the existing category+tier options rather than replacing them, deviating from the
    scope: "Bench as a T1" and "Bench as a T2" are genuinely different slots with different loads,
    and collapsing them would lose a distinction someone deliberately set up. `liftTopSetSeries()`
    is built on the same resolver as the targets and the PR log — three readers, one definition of
    "your best", so a deload set is excluded from all three.

- **Exercise targets, and the PR log (2026-09-14).** Step 8 of "Phases Own the Plan". A training
  goal has no weight target, so **its progress IS its targets** — this is the piece that makes the
  second goal type mean something.
  - **`bestForLift(liftId, since)` is shared by both halves.** "Exercise PR log" sat on the backlog
    unbuilt, and it's this feature from the other side: a PR log asks *when did I hit a new best?*, a
    target asks *how far am I from a best I've named?* Building it once is why they can never
    disagree about what your best is. `liftIdForLogEntry()` does the real work — mapping a log entry
    back to a lift differs by workout shape (GZCL tier → category's `liftId`, `t3_<i>` → that slot's,
    a flat entry key IS the exercise id), and one walk beats four call sites re-deriving it.
  - **Deload sets are never personal bests.** The same reasoning `progressionLogFor()` exists for,
    applied to a different question: reduced work on purpose can't be a best any more than it can be
    a progression base.
  - **Three deliberate limits**, all load-bearing:
    - **245 × 3 does not satisfy 225 × 5.** Forced by ruling out e1RM — with no formula you can't
      compare across rep ranges, so a set must meet or exceed *both* numbers. Conservative, and never
      wrong in the direction that matters.
    - **No projection.** Weight loss is roughly linear against a deficit, which is what makes
      projecting it defensible; strength and cardio move in steps and stalls, so a straight line
      would be confidently wrong most of the time — worse than silent. Current, target, gap.
    - **Measured since the goal started.** A goal is about what you do during it, so a 250 from two
      years ago doesn't complete one today. The **lifetime best sits alongside as context** — useful
      precisely when the goal *is* getting back to something.
  - **1RM and Rep Max stay two named types** rather than one `weight × reps` field: "I want 225 on
    the bar" and "I want to own 225 for five" are different ambitions, and the vocabulary is already
    the app's — `TEST_CONV_MAP` has carried 1RM/5RM/10RM for training-max work all along. A 1RM's
    read-out shows the weight only; printing reps there would blur the distinction the split exists
    to keep.
  - **Three of the four are personal bests** — monotonic, achieved the moment you touch them. **Total
    distance is cumulative and window-bounded**: meaningful only inside its goal, always climbing,
    reset by the next one.
  - **A cardio time reads the lowest minutes on any session that actually covered the distance.** A
    run that fell short can't stand in for it however fast it was.
  - Third time `.ehead` has bitten: its flex layout is scoped to `.entry-card .ehead`, so the target
    card's delete button dropped onto its own line until it declared its own. Now asserted in the
    test rather than just fixed.

- **The lift library (2026-09-14).** Step 7 of "Phases Own the Plan", in `src/app-lifts.js`, and the
  prerequisite for everything below it — the piece that finally gives the app one durable way to
  name a lift.
  - **Why an exercise id can't be the answer.** Phases own plans, so every new block builds a new
    plan with new `uid()`s. A target or a PR pointing at an exercise id would break at *every block
    boundary* — the exact thing the phases feature exists to make routine. Lift identity has to
    outlive the plan, by construction.
  - **What was broken before:** GZCL's T1/T2 reference a `categoryId`, but **T3 slots use free text**
    — so a single workout style carried two identity schemes. Flat-list exercises had only a `name`
    and a `uid()` unique to that exercise in that workout.
  - **A Lift is pure identity:** a name and a muscle, nothing about programs, tiers or training
    maxes. A category **gains** a `liftId` rather than being replaced by one — "Bench" the lift and
    "Bench as a GZCL category with a T1 training max of 245" stay different things.
  - **101 lifts ship** across all fifteen muscle groups, **equipment-leading**: Barbell Bench Press,
    Dumbbell Bench Press, Incline Barbell Bench Press. A bare "Bench Press" is exactly what must not
    exist — three different loads and three different progressions, and collapsing them would corrupt
    all three histories at once. A `short` rides along for log rows (`BB Bench`).
  - **Nothing merges automatically.** An exact name match is not a guess and gets a one-tap link;
    everything else is a **suggestion** a person chooses between. That's where fuzzy matching earns
    its place — generating candidates, nowhere near the code that assigns. A wrong automatic merge
    fuses two lifts' histories permanently with no undo; a wrong suggestion costs a glance. Scored on
    shared *words* rather than edit distance, because the failure to handle is a missing qualifier
    ("Bench Press" → "Barbell Bench Press"), not a typo.
  - **Muscle first, then the lift.** Choosing Chest and seeing a dozen options beats scrolling two
    hundred, and muscle alone makes the list short enough that a second filter isn't worth the tap.
    One picker serves categories, flat exercises, T3 slots and the review screen via a token, so none
    of them knows about the others.
  - **`allLifts()` concatenates rather than merging into STATE**, so the shipped list can grow
    between releases with no migration and a hand-added lift can never be shadowed by one.
  - Two **vacuous-assertion** bugs caught in my own test: the "no duplicate lift" check passed for
    the wrong reason because the picker had never rendered so nothing was typed — and then again
    because the row it picked had an *exact* match and correctly showed no picker at all. `render()`
    is rAF-deferred, so opening a picker and typing into it must straddle a `settle()`.

- **Deloads (2026-09-14).** Step 6 of "Phases Own the Plan". Reduced volume *and* maintenance
  calories, all of it applied at **display time** — a saved workout is never edited, so turning a
  deload off restores the real numbers exactly rather than leaving a halved version behind.
  - **`progressionLogFor(cycle, workoutId)` is the part with teeth.** If workout A runs in cycles
    A1, A2, A3 and A2 is the deload, A3 must progress from A1. Four functions walk cycles and every
    one would have been corrupted: the two backward walks (`t3HistoryBaseWeightLb`,
    `rpExHistoryBaseWeightLb`) take the first logged weight they find, so a 50% deload weight would
    silently become the next cycle's base **and stay there**; the two forward walks
    (`computeStageState`, `computeT3StageState`) read reduced reps as a *failed* stage, so a deload
    wouldn't merely fail to progress you — it would knock you back one. All four now go through one
    choke point rather than four guards free to drift apart.
  - **`computeRpSuggestion()` needed separate handling**, because it reads the *current* entry rather
    than history: high RIR at deliberately reduced volume would otherwise come back as "sets felt
    easy, add weight". AMRAP is suppressed on a deload for the same reason.
  - **The stamp is frozen on first write, never recomputed from dates.** `log.deload` records what
    actually happened even if the phase's boundaries move afterwards — extending a block must not
    silently rewrite which of your past sessions counted. An unstamped log predates the feature and
    is ordinary work; it is never retro-classified.
  - **Both counts floor at 1.** 50% rounded down turns a 1-set exercise into 0 sets and a 1-rep
    target into 0 — silently dropping work that "Acc Exercises: On" just promised would still be
    performed. The only thing that removes an exercise entirely is turning accessories off.
  - **Cutting a target never deletes logged sets.** `renderTierBlock()` used to truncate
    unconditionally to `stageDef.sets`, which was safe while the target came only from a fixed stage
    scheme. A deload can lower it mid-session, so it now truncates to `max(target, last logged + 1)`
    — an honest record of a session that started full and got cut short.
  - **T3 is the accessory tier, for free.** It's absent from the training-max config precisely
    *because* it carries no TM, which is what makes it accessory work — so "Acc Exercises: Off" drops
    exactly those, with no marking and no ambiguity. Every other shape is a flat `exercises[]` list
    with no tier, and inventing one isn't worth it: deriving it from `muscle` doesn't hold up (a leg
    extension is Quads, a cable flye is Chest — both would read as main work). The toggle has no
    effect there; the other three scalings still apply.
  - **Deloads are asynchronous, not only weekly.** One lift can need backing off while the others
    carry on. Promote any single workout, *or* demote one inside a deload week to full volume —
    progression follows for free, since `log.deload` is the only thing the choke point reads.
  - **P-Zero (GZCL) opts out of the trailing week by default** — that program already deloads as it
    goes, so stacking another on top would be deloading a deload. Promoting one by hand still works.
  - **The one deliberate cross-goal effect:** a deload week overrides calories to maintenance, since
    eating at a deficit through a deload defeats the point of taking one. With no weight goal running
    there is simply nothing to override — `STATE.diet.tdee` already *is* maintenance, so the rule
    reads the same in both cases and just has nothing to do in one of them.
  - A bug caught by its own test: `phaseDeloadWindow()` checked `deloadTrailing` for truthiness,
    but the design is **on by default** with an explicit `false` for off — so it disagreed with both
    the toggle and the card's ON/OFF button, and no block ever got a deload.

- **Exercise goals and per-block training plans (2026-09-14).** Step 5 of "Phases Own the Plan", and
  the largest of them. The second goal type had to arrive with this rather than later: a block
  carrying a plan has to belong to something, and that something is a training goal.
  - **Starting a new block never destroys the old one.** A block's `exercisePlan` is seeded as a deep
    **copy** of whatever plan was in effect where it starts — a running start rather than a blank
    week, and never a shared reference. Aliasing there would be invisible right up until the day you
    looked back at what you used to be doing and found it rewritten.
  - **`exercisePlanInEffect(date)` answers which plan governs a date, and why:** `'phase'` (a block
    covers it), `'carried'` (no block covers it, but an earlier one's plan is still what you're
    running), or `'global'`. **`'carried'` is the deliberate answer to "the goal ended, now what?"** —
    a plan that was working doesn't stop working because a date passed, so it continues and the
    Planner says so rather than silently reverting you to a plan you last touched months ago.
  - **With no training goal, nothing changes.** `STATE.exercisePlan` keeps its exact meaning as the
    plan in effect before any block exists. Nothing was migrated into a phase; the Planner, Home and
    the Day view behave for a non-user of this feature precisely as they did before it shipped, and
    the Planner's scope banner doesn't render at all when there's only one plan to show.
  - **One editor, not two.** The block card shows what a block holds and points at the Planner; the
    Planner edits whatever plan is in effect and names it, with tabs to page into another block.
    Building a second weekday editor on the GOAL tab would have given the app two places to change
    the same seven days.
  - **One active goal per KIND.** A weight goal and a training goal are *meant* to run together —
    each owns exactly one scarce resource (calories / training), which is what removes any precedence
    rule between them. `unarchiveGoal()` now checks per-kind; checking globally would have blocked
    the intended pairing.
  - **`deleteWorkout()` now clears every plan**, not just the global one — a workout assigned inside
    a block would otherwise survive its own deletion and render as a blank row in that block forever.
  - **No pace or projection on a training goal, on purpose.** Weight loss is roughly linear against a
    deficit, which is what makes projecting it defensible; strength and cardio move in steps and
    stalls, so a straight line through them would be confidently wrong most of the time. Its progress
    becomes its *targets* in step 8.
  - **Deferred honestly:** the scope's *"Phase 3 goal achieved — keep pushing!"* variant of the
    carried-plan message needs exercise targets to know whether a goal was actually met. Until step 8
    there is nothing to measure that against, so only the plain version ships — claiming an
    achievement the app can't verify would be worse than saying less.

- **The calorie loop: per-phase targets and weekly TDEE drift (2026-09-14).** Step 4 of "Phases Own
  the Plan", and the point at which the rolling TDEE earns its keep.
  - **A rate converts to calories by arithmetic** — lb/week x 3500 / 7 = kcal/day, so -1.0 lb/wk *is*
    -500 kcal/day. What keeps it honest is that the delta is applied to the **rolling TDEE**, measured
    from your own weight trend against what you actually ate, rather than to a formula's guess.
  - **`calorieTargetForDate(date)` is the only thing that decides which number wins.** Order: the
    phase covering that date, then `STATE.diet.tdee`, then nothing. It's per-DAY, not global, because
    the Diet log pages backwards into days a different phase covered. Step 6 adds one rung above it —
    a deload week overriding to maintenance — and the order is already the order it will keep.
  - **Both screens name their source.** Per-phase targets mean the number you're eating against lives
    in two places depending on the day, so the Diet log says *"target from phase 'Push to race'"* and
    the TDEE field says *"Not what today is compared against"* when a phase has taken over. Without
    that, the TDEE field silently reads as the target while the log compares against something else.
  - **It never moves on its own.** As you lose weight your TDEE falls, so a fixed deficit quietly
    means eating less over time. The app re-reads weekly (`PHASE_CALORIE_RECHECK_DAYS`) and only
    speaks up past `PHASE_CALORIE_DRIFT_MIN` (50 cal) — below that a new figure is inside the
    estimate's own error and would be a nag. **Accepting and declining are both answers:** "KEEP MINE"
    resets the weekly clock without changing the number, so a declined offer isn't re-asked tomorrow.
  - **Only the current phase is ever re-offered.** A future phase can't have drifted; a past one is
    history, and rewriting what it told you to eat after the fact would be rewriting the record.
  - **Seeding refuses rather than guesses.** With no rolling estimate there's no seed and the button
    says why — the same "not yet" posture as the rest of the feature.
  - **Adding a phase leaves the target unset.** A calorie number you'll eat against daily for weeks
    gets an explicit "use this", the same as the TDEE estimate; adding a phase shouldn't quietly
    change what you're eating.
  - One CSS call: the drift offer doesn't reuse `.suggestion-box` — two buttons in a column beside
    its text wrapped "USE THIS" and "KEEP MINE" onto two lines each at phone width.

- **Fixed a time-of-day flake in `test_day_fold.js` (2026-09-14).** It asserted a folded block's name
  was absent from the whole `#app` innerHTML. Run near midnight, the fixture squeezes every block
  into the same few minutes, so the *visible* "now" row legitimately carries a clash chip reading
  `title="Overlaps Passed 0, … Passed 4"` — and the test failed at 00:41 while the fold itself worked
  perfectly. Now scoped to the text of rendered `.day-row` elements. Asserting on the wrong surface,
  not a real regression.

- **Phases: the blocks a goal is actually run in (2026-09-13).** Step 3 of "Phases Own the Plan",
  in `src/app-phases.js`. Name, length, direction and rate per phase, shown under the active goal.
  Still no calorie authority (step 4) and no plan ownership (step 5) — this is the timeline and the
  rate maths.
  - **A phase stores its LENGTH, never its start date.** Phases run back to back from the goal's
    start, so every start is a running sum of the lengths before it. The scope called for a stored
    `startDate`; deriving it is strictly better, because the rule that matters most — *extend a phase
    and every later phase, and every deload inside them, pushes out by the same amount* — stops being
    an operation that has to remember to rewrite N records and becomes a property of the model.
    Reordering and deleting fall out of it for free too. Same reasoning as the goal's required rate
    being computed on every read.
    - What it costs is the ability to represent a **gap** between phases. That's the right trade: an
      unplanned stretch mid-goal isn't something you schedule. Both ends are reported instead — a
      plan running past the target date, or leaving weeks unplanned, shows in the summary line.
  - **Extending never re-paces you.** `extendPhase()` changes one number; the goal's required rate is
    deliberately not recomputed to claw the time back. The projection moves later and the pace reads
    behind, which is the truth. Re-pacing without being asked is how an app turns a good week into a
    harder target.
  - **Rates compound, because a percent of bodyweight tracks a bodyweight that's moving.** 0.75%/wk
    off 232 lb for ten weeks is 215.2 lb, not the 214.6 lb a linear read gives.
  - **Direction carries the sign; the stored rate is only a magnitude.** A signed rate would let a
    phase labelled "Surplus" hold a negative number and mean the opposite of its own label.
  - **`phasePlanSummary()` is the line that justifies writing phases down.** Three individually
    reasonable phases can fill the goal's 22 weeks exactly and still land 6.6 lb short — nothing but
    the arithmetic will tell you that. `addPhase()` seeds a new phase to close whatever gap is left,
    solving the rate rather than copying the goal's linear figure.
  - **`PHASE_TARGET_TOLERANCE_LB`.** Rates are stored rounded to 0.01 %bw/wk so the screen and the
    arithmetic agree — checking the app's work by hand shouldn't give a different answer. The cost is
    that a plan lands within that rounding of its target (a fifth of a pound over 22 weeks), and
    calling that "short of target" would be the app nagging about its own rounding.
  - **`phaseForDate(date, kind)` is the choke point** steps 4 and 5 will both read through. It scans
    archived goals too, so a date inside a finished goal still resolves.
  - **Orphan phases can't survive.** `deleteGoal()` cascades, and `migrateState()` drops any phase
    whose goal is gone — cheaper than a guard at every read.
  - **Two CSS traps, both found by looking at the render:** `.ehead`'s flex layout is scoped to
    `.entry-card .ehead`, so a phase card dropped its state chip onto its own line until it declared
    its own; and `.phase-label`'s `border: none` (0,1,0) silently lost to the base
    `input[type="text"]` rule (0,1,1), so the selector is `input[type="text"].phase-label`. The same
    trap already documented on `.log-water-target`.

- **Found and fixed: `updateGoalField` was defined in two files (2026-09-13).** `app-budget.js`
  (savings goals) and `app-goals.js` (weight goals) both declared it. Classic scripts, so the later
  script in load order simply won — budget — and **editing a weight goal's name or target silently
  did nothing.** Nothing threw; `tsc` was happy; the weight-goal tests passed because none of them
  clicked that control. Renamed to `updateWeightGoalField()`.
  - **`test_smoke.js` now asserts no two `src/app-*.js` files declare the same top-level function
    name** (819 of them at the time of writing), reading the files apart via a new `appFiles()` in
    `tests/helpers.js` — `appSource()`'s concatenation destroys exactly the information the check
    needs. This is a hazard the `app.js` split created: one file could never collide with itself,
    nineteen can, and the failure mode is completely silent.

- **Weight goals: pace, projection and an advisory rate band (2026-09-13).** A new GOAL subtab in
  Health & Diet, and `src/app-goals.js`. Step 2 of the "Phases Own the Plan" scope — phases,
  per-phase calorie targets and exercise goals build on top of this, and `kind: 'weight'` is on the
  goal record from day one for that reason.
  - **The goal holds the destination and the deadline; the rate is derived.** Storing a rate *and* a
    date is the usual way this feature ends up fighting itself — edit one and the other silently
    contradicts it. Here `requiredLbPerWeek` is computed on every read, so there is nothing to fall
    out of sync. Phases will own how hard you're pushing *right now*; the goal keeps owning where
    you're going. Keeping those at two levels is the whole reason it's built this way.
  - **The actual rate reads the 7-day trailing average the Body Weight chart already draws**, not
    raw entries. Bodyweight swings pounds on water alone and a rate off two raw readings swings with
    it. `weightTrendRateLbPerWeek()` measures over the last `GOAL_RATE_WINDOW_DAYS` (28) — recent
    enough to reflect what you're doing now, long enough that one heavy dinner doesn't move it.
  - **Every row can say "not yet", and does.** Under `GOAL_RATE_MIN_DAYS` (14) of weights there is no
    honest rate, so none is given — reporting 0 lb/wk there would read as "you're going nowhere" when
    the truth is "ask me later". Likewise there's no projected date when the trend is heading *away*
    from the target: extrapolating that would hand back a date in the past. That's the normal state
    for a goal's first fortnight.
  - **Nothing auto-completes.** Reaching the weight or passing the date is reported and then waits —
    same posture as a checked-off reminder staying on its day. Archiving is the only way a goal ends.
  - **The rate band is advisory and reads the goal's LENGTH.** 1.2 %bw/wk over five weeks is a
    mini-cut; the same number over twenty weeks isn't, so past `GOAL_MINICUT_MAX_WEEKS` (6) the
    ceiling drops back to 1%. Percent of bodyweight is the unit because what a rate *means* changes
    as you descend. Nothing is ever blocked — the band names where a rate sits, the same way the
    water target is documented as "a target, not a cap".
  - **`fmtGoalDate()` rather than `fmtDueDate()`**, because a projection lands wherever the arithmetic
    puts it. A slow cut projected into next June rendered as a bare "Jun 6" and read as this June —
    caught in a screenshot, not in the markup. The year now appears only when it differs.
  - **One active weight goal at a time**, enforced in `createWeightGoal()` and `unarchiveGoal()`.
    `goals` was added inline as `[]` in `defaultState()` rather than via a `defaultGoals()` call:
    `defaultState()` runs during `app-state.js`'s own evaluation and so can only reach files loaded
    *before* it — `app-goals.js` loads after. The same load-order rule as `HOME_BOX_RENDERERS`.

- **Reminders can be checked off, and their lead time edited after creation (2026-09-13).**
  - **Checking off deliberately does not delete.** The reminder stays on its day so you can look
    back and see that you did it, rather than being left wondering because the row vanished — which
    is the whole reason for it. What changes is that it stops claiming attention: dimmed and struck
    through on the Day view, Home's today box and the Agenda, and no longer marked past due.
  - **`reminderIsDone()` is the single definition** the past-due mark, the dimming and the push
    payload all read. A to-do with every box ticked counts as done without the parent also being
    checked — that was already the past-due rule, and unifying it is what stops the checkbox and the
    checklist ending up disagreeing about one reminder.
  - **A done reminder is dropped from the push sync entirely**, not dimmed there. The backend has no
    concept of "done" — it fires whatever it was last given on the matching date+time — so not
    sending it is the only way to stop the notification. Un-checking re-syncs it.
  - **Lead time is now editable on any reminder**, closing the gap where it could only be set at
    creation, so fixing one meant deleting and remaking the reminder. Adding a lead time to a
    reminder that had none adopts its existing `date` as the `dueDate`; every later edit recomputes
    the fire date *from* that due date rather than shifting again from the current one, which would
    otherwise compound and walk the reminder further into the past with each edit.
  - **Two CSS traps worth recording**, both caught by looking at the rendered result rather than
    trusting the markup:
    - Dimming is applied to each CHILD, not the card. `opacity` on a parent compounds onto
      everything inside and **cannot be raised back by a child**, so `.reminder-done { opacity }`
      plus `.hit-mark { opacity: 1 }` still renders the tick dimmed — making the one control you
      need in order to UNDO this the hardest thing on the card to see.
    - `.hit-mark` is `display: flex` in a fixed 20px circle, and is a `<div>` everywhere it only
      shows state. Used as a `<button>` for the first time here, its UA padding left ~6px of content
      box and squashed the 14px check into an invisible sliver — it rendered the entire time.
      `button.hit-mark` now resets padding/background/font.

- **Budget charge due dates: a calendar marker, an opt-in push reminder, and a general lead-time
  field on any reminder (2026-09-13).** The one piece deliberately left out of the earlier
  calendar-union work — a `RecurringCharge` had no due-date field at all.
  - **The marker and the push reminder are two separate things, on purpose.** `dueDay` (1-31,
    clamped to a shorter month's last day) puts a charge on the calendar union — Day view, Agenda,
    month grid — with zero notification involved. Confirmed by reading the deployed push worker
    directly (`reminder-worker/src/index.js`): it skips any reminder with no `time` set, so a due
    date alone can never push anything. `test_charge_due_dates.js` asserts this by reading the
    worker source itself, not by assuming it.
  - **"Remind me" creates a real, ordinary monthly-recurring Reminder** — the exact recurrence
    engine the recurring-reminders feature already shipped (`recurrenceId`,
    `RECURRENCE_HORIZON.monthly`, `ensureRecurringReminderOccurrences()`), so it rides the existing
    push pipeline for free with zero worker changes. It's editable afterward exactly like any other
    reminder (title, notes, time); editing the charge's **name or amount never touches** an
    already-created reminder — only `dueDay` changing rebuilds the series, since the date is what
    the reminder fundamentally is.
  - **A general lead-time field, not just a charge-specific one** — added to the ordinary reminder
    form (any plain reminder, recurring or not), because a due-date reminder firing after the thing
    it's about is a reminder that arrived too late to act on. `Reminder.dueDate` (what it's about)
    and `Reminder.date` (when it fires) split apart by `leadDays`; every read path that looks a
    reminder up by date (`remindersOn`, the push worker, the Month/Year dots) still keys off `date`
    unchanged — a lead-time reminder lists and fires on its early date, with a "due Sep 30" badge
    everywhere it appears (the card, the Agenda, and the push notification's own title, built by a
    new `reminderPushPayload()` that decorates what's *sent* without ever touching the stored
    `title`).
  - **A recurring reminder always stores `dueDate`, even at zero lead time** — a late design
    correction caught before it shipped. The first draft only stored it when `leadDays > 0`, which
    meant editing a charge's lead time later had to reverse-engineer the due date by regex-parsing
    an occurrence's id and re-deriving it — fragile, and broken for string-vs-number id-suffix
    coercion in exactly the way that class of bug always is. Always storing it makes
    `updateChargeReminderLead()` a two-line function with nothing to reconstruct.
  - **Savings charges are included** — a scheduled transfer to savings is exactly as "due" as a
    bill, and `dayModel()`'s `charges` list makes no distinction. **Not paused by a schedule
    exception**, same reasoning as habits: a due date has nothing to do with which daily schedule
    you're following.
  - **`STATE.settings.defaultReminderTime`** (default `09:00`, editable under Schedule → Setup)
    exists only because an all-day reminder can't push — it's what a charge's "remind me" toggle
    uses so the created reminder is push-capable immediately, and only affects reminders created
    from that point forward, not anything already made.

- **Hydration colour: trend strip, water association, staleness — and section colours derived
  rather than copied (2026-09-13).**
  - **Trend strip**: the last ten readings, oldest to newest, under the swatches. One dark reading
    is a moment; four in a row is a direction, which a single current swatch can never show. Fewer
    than two readings renders nothing — one dot is just the marker again. Built entirely on
    `waterColorLog`, which had been recording changes unused since the marker shipped.
  - **Water association**: average colour on days you hit your water target versus days you didn't,
    with the day counts behind each. Deliberately descriptive, never causal or diagnostic — urine
    colour carries real medical signal beyond hydration, and anything phrased as a finding would
    overreach what a self-reported swatch supports. Several readings on one day average into a
    single figure for that day, so a day you happened to check four times can't outvote three other
    days. Refuses to print below `WATER_INSIGHT_MIN_DAYS` (3) on **both** sides: two averages drawn
    from one day each would be noise wearing the clothes of a finding.
  - **Staleness**: past 12 hours the chip's dot dims and dashes and the sheet says "worth a fresh
    look". It is never cleared automatically — that would throw away the only reading there is.
    Twelve hours because hydration turns over across a night, not across an afternoon.
  - **Section colours are now derived, not hand-copied — and that surfaced a real drift.**
    `entityColor(type)` reads `LINKABLE_TYPES[type].section` and looks the colour up in
    `HOME_SECTION_META`. The Day view's untimed band and the Agenda had been carrying hex literals
    copied by hand, and one had already gone wrong: **habits rendered in the Hobbies purple
    (`#CAAFFF`) while their link chips were Schedule blue (`#819FFF`)**, because the two were
    written months apart from the same mental list of nice colours. The Agenda's planned-workout
    marker separately wore the generic anchor blue, which said "schedule block" about something
    that is not one.
  - `test_section_colors.js` protects the **derivation**, not the current hex values — asserting
    "habits are #819FFF" would just be the same hand-copied literal in a second place. It ends by
    reading `app.js` and failing if any entity surface contains a section hex at all.

- **Water in millilitres, a hydration colour marker, and "upcoming" (2026-09-13).**
  - **Water is stored in millilitres and displayed in whichever unit is set** — the same
    store-canonical/convert-at-the-edge shape weight already uses (`weightLb` + `lbToDisplay`).
    `settings.waterUnit` (`'ml'` default, `'cup'` optional) only changes what you see and type;
    switching it never touches the stored number, so past days can't silently rescale.
    `waterServingMl` (250 default) is what one tap of the chip adds, settable in whichever unit is
    showing.
  - **The glasses→millilitres change renames the field rather than reinterpreting it.** Water
    shipped counting glasses for a few hours earlier the same day, and a stored `8` is unreadable on
    its own — eight glasses or eight millilitres? Guessing from magnitude would be a coin flip on
    small values, so `water` → `waterMl` (×250) and `waterTarget` → `waterTargetMl`, with the old
    keys deleted so a second load can't double them. Covered, including idempotency, in
    `test_quick_logs.js`.
  - **The hydration colour marker is deliberately inert.** Eight swatches, pale to dark, the scale
    every hydration chart uses. Nothing computes off it — its whole job is to *still be showing what
    you last saw*, so it lives on `STATE.life.waterColor` rather than in `dailyLog`: it persists
    until changed instead of resetting at midnight, because it describes a current state rather than
    something that happened on a date. That's the one behaviour separating it from everything else
    on these strips, and the test asserts it survives a day rollover.
  - **The marker shows as a dot on the water chip**, not only inside the sheet — a marker you have
    to open something to see isn't a marker. The sheet also says how long ago it was set, since a
    reading from three days ago says nothing about right now. Tapping the active swatch clears it,
    the same toggle-off the habit buttons use.
  - **`waterColorLog` records every change and is unused today.** It costs nothing and is what any
    trend view would have to be built from; building the view itself was left out deliberately.
  - **Swatch colours are fixed hex, NOT theme tokens.** This is a physical reference scale — the
    whole point is holding it up against something real — so it must not follow the aesthetic's
    palette. The selection ring is the part that adapts.
  - The collapsed day timeline's second band now reads **"N upcoming"** rather than "N coming".
    One renderer, so this changed on the Calendar Day view too, not just Home.

- **Quick logs become two chip strips and a sheet; water and steps added (2026-09-13).** Step 5,
  the last of the "Home Becomes Today" scope. WAKE-UP and CALORIES were two panels of
  always-visible number inputs — about 360px of Home, the single biggest block on the screen, for
  fields that sit empty most of the day and tell you nothing about what you already logged. They're
  now two strips of chips carrying today's actual values (~160px), with the inputs moved into a
  bottom sheet you open by tapping one.
  - **Split AM/PM because that's when you log them** — weight and sleep on waking, calories and
    steps at the end of the day. They stay two independently hideable boxes, and critically the ids
    stay `wakeup`/`calories`: the boxes changed shape, not identity, so **no saved layout needed
    migrating**. A third `boxOrder` migration in one day would have been a third chance to lose
    somebody's Home arrangement.
  - **"LOG ·" prefixes both labels** rather than one shared heading. Home's box system gives every
    box its own heading, so two independently hideable boxes can't literally sit under one — the
    shared prefix is what makes them read as one section anyway.
  - **The water chip logs directly instead of opening the sheet.** It's the one of these you hit
    several times a day, and a sheet-open-type-save round trip for a glass of water would be absurd.
    It also shows `0/8` rather than a dash when unlogged, because that's the number that makes you
    drink something. Clamped at zero, deliberately **not** clamped at the target — a target is not
    a cap.
  - **A blank field clears rather than being skipped.** The sheet opens pre-filled with what's
    already logged, so a blank is a deliberate act; the old per-field LOG buttons refused empty
    input, which meant there was no way to undo a typo'd weight from Home at all.
  - **An empty `weightLog` row is never created by browsing.** Those rows feed the TDEE rolling
    window, so a row created just by opening and closing the sheet — or by saving only sleep, which
    lives on the life log — would quietly skew the estimate. Covered directly in the test.
  - **New state:** `water` and `steps` on `life.dailyLog[date]` (the daily *behaviour* log, where
    `sleepHours`/`sleepQuality` already live — not `WeightLogEntry`, which holds body composition
    and the calorie figure feeding TDEE), plus `settings.waterTarget` (default 8, set from inside
    the PM sheet since that's the only place the number is ever looked at). `dailyLog`'s type was
    declared `Record<string, boolean>` and had been holding numbers since sleep logging shipped;
    now declared honestly.
  - `test_full_flow.js`'s Home weight check was looking for `input#homeWeightInput` — an id that has
    never existed in this app — and shrugging when it found nothing, so it logged "skipping" on
    every run since it was written and tested nothing. It now drives the real AM sheet.

- **Home becomes the schedule: it carries the day's bottom bar, and the SCHEDULE tile retires
  (2026-09-13).** Steps 3 and 4 of the "Home Becomes Today" scope, on top of the fold and the day
  box shipped earlier the same day. Only step 5 (regrouping the WAKE-UP and CALORIES quick-logs into
  one band) is left.
  - **Home was the one screen in the app with no bottom bar**, which is exactly why Calendar and
    Agenda cost two taps from it — you had to leave through the SCHEDULE tile. Home renders the day
    now, so it carries the day's own screens: `HOME / CALENDAR / AGENDA / SETUP`, with `goSchedule()`
    as the single entry point (also used by the day box's own link). It routes through
    `switchTab('schedule')`, which is what snaps the calendar back to today's Day view — so arriving
    from Home never drops you on a date you browsed to twenty minutes ago.
  - **The word stays HOME on every bar, including Home's own.** The screen changed; the name for
    "the screen you start on" didn't, and the date line under the title already says which day you
    are looking at. Considered and rejected: renaming to TODAY everywhere (touches all seven tabbar
    branches for a word), and title-Today/button-HOME (the button and its destination's heading
    would disagree).
  - **Five tiles, one compact row.** Five doesn't fill a 3-column grid, and full-size tiles pushed
    the day itself off the first screen — which matters more now Home leads with the day rather than
    with navigation. `.home-tile-row` overrides `.workout-grid`'s columns and `.workout-cell`'s
    square ratio; those size the Exercise grid, where a big square tile *is* the point.
  - **`HOME_SECTION_META.schedule` deliberately SURVIVES the tile's removal.** `LINKABLE_TYPES`
    colours every reminder, habit and activity link chip from it, so deleting the entry would drop
    those chips to an unstyled fallback with nothing failing anywhere. This is also why the retired
    tile has to be filtered out of saved layouts *by name* rather than left to the stale-id guard —
    the guard keys off `HOME_SECTION_META`, which still has the entry.
  - **`initialTab()` — a real ordering bug the test caught.** `NAV.currentTab` is initialised at
    NAV's declaration, top-level and in source order, which runs BEFORE `loadState()`'s migrations.
    Migrating `defaultPage: 'schedule'` to `'home'` therefore corrected what was stored and still
    booted you onto the dead tab. The landing tab is now validated at the point of use, so it can't
    depend on that ordering, and anything unrecognised falls back to Home.
  - `body.no-tabbar` and its CSS rule are gone — nothing can reach them now that every screen has
    a bar. `index.html` still ships the bar as `.hidden` so an empty one never flashes before the
    first render.
  - **Two long-standing suite flakes fixed, both the same measurement-unit mistake.**
    `test_aesthetic_external.js` waited for a *stylesheet fetch* using two animation frames and
    failed intermittently with phantom "missing tokens"; `test_aesthetic_fx.js` told a continuous
    particle module from a tap-triggered one by whether it had painted within two frames, and under
    load misread cartomancer as tap-triggered, then failed on "canvas should start empty". Both now
    wait for the condition itself on a real budget. The suite ran clean three times in a row after,
    which it had not managed all session.

- **Home and Schedule start merging: the day folds, and Home renders it (2026-09-13).** Steps 1
  and 2 of the "Home Becomes Today" scope — Home stops being a menu you pass through on the way to
  your day. Steps 3-5 (Home gains a bottom bar, the Schedule tile retires, the quick-logs regroup)
  are not done.
  - **The day timeline folds around the moment you're in.** A default day is 12 anchors; rendered
    in full that's a wall of rows where the one thing you want — what am I doing, what's next — is
    buried in the middle. `partitionDayBlocks()` splits the day into passed / underway / coming, and
    the two outer groups collapse to a count you can open. Each band still answers something while
    closed: how much of what's behind you got done, and what's next.
  - **The split is by clock span, not by which block won the NOW badge.** Two overlapping blocks can
    both genuinely be underway, and calling the wider one "passed" because `currentScheduleBlock()`
    singled out the narrower one would be a lie about the day. Midnight-crossers are active on both
    sides of the wrap; a zero-length block is never underway.
  - **A closed band renders no rows at all** rather than hiding them with CSS — a hidden band would
    still bloat the DOM and still be found by every `querySelector` in the app.
  - **Folding applies to today only.** Another date has no "now" to fold around, so every block
    would land in one band: the full day with an extra tap in front of it. Days under
    `DAY_COLLAPSE_MIN` blocks don't fold either, because there's nothing worth hiding.
  - **Home's RIGHT NOW, TODAY'S WORKOUTS and HABITS boxes became one `day` box** that calls
    `renderDailySchedule()` and `renderDayUntimedItems()` — the Calendar Day view's own renderers,
    not a parallel summary of them. `test_home_day_box.js` asserts substring identity rather than
    "both mention the workout", which is what makes disagreement impossible rather than unlikely.
    Three boxes rendering one `dayModel()` call is exactly what caused the Home/Calendar
    disagreement fixed earlier the same day.
  - **`boxOrder`/`boxHidden` are saved state, so the merge needed a real migration.** `day` inherits
    the slot of the earliest of the three *in that save's own order* (someone who dragged TODAY'S
    WORKOUTS to the top should find the day box at the top, not wherever RIGHT NOW was left), and is
    only visible if at least one of the three was — hiding all three was a choice to have a Home
    without the day on it, and that survives. Stale ids are now filtered out, since one would
    otherwise render as a permanently empty box that edit mode still lets you drag.
  - `toggleHabitToday()` is gone; Home's habit buttons are the Day view's own date-carrying
    `toggleHabitOn()`. `test_home.js` no longer clears the anchors — it did that so RIGHT NOW would
    fall back to its clock-independent "FREE TIME" card, and the day box needs the opposite (with
    nothing set up at all it renders nothing).

- **One shared day model: every surface now gets the same answer to "what is on this day"
  (2026-09-13).** Home's TODAY'S WORKOUTS box, Home's HABITS box, the Agenda and the Calendar Day
  view each derived this independently, and they disagreed. Measured before building: on a day
  marked off, Home showed the planned workout and prompted its habits while Calendar Day for that
  **same date** said the plan was paused. Nothing made them agree — each surface just happened to
  apply, or forget, the exception rule on its own. `dayModel(dateStr)` now states the rule once
  (plus `todayModel()`, which is only `dayModel(todayStr())` named so the intent reads at Home's
  call sites) and returns the day's schedule, blocks, booked minutes, reminders, planned workouts,
  planned meals and active habits. A surface chooses what to *show*; it no longer gets a vote on
  what is true. Same store-once/compute-nothing-twice shape as the link primitive.
  - **A day off no longer pauses habits — this is a deliberate behaviour change.** Planned workouts
    and meals come from weekday *templates* (`exercisePlan[weekday]`, `mealPlan[weekday]`), derived
    from the schedule you have explicitly said you are not following, so they pause with it. A habit
    is a standing commitment with its own start/end dates and its own streak and was never part of
    that template: a holiday is a day off from your schedule, not from stretching, and silently
    pausing habits breaks a streak the user never chose to break. Calendar Day used to pause all
    three; it now pauses two, and Home (which paused none) matches it.
  - **A swap exception still cancels nothing.** An exception carrying a `scheduleId` reshapes the
    day rather than cancelling it. Both kinds are rows in the same array separated only by whether
    `scheduleId` is null, which is the distinction most likely to get lost in a future edit, so the
    test covers it directly.
  - **`hasWeekdayPlan(weekday)` exists because the model empties the lists before any surface sees
    them** — the "paused" notice has to consult the template directly, or a day off with nothing
    planned anyway would announce a pause that cancelled nothing.
  - Two stale copy strings said the old rule out loud (the Day view banner and the Setup
    exception list, both via `scheduleExceptionEffect()`); both now say "Habits carry on", and
    Home's empty workouts box explains a day off instead of saying "nothing scheduled".
  - `test_day_model.js` ends with a structural guard: it reads `app.js` and asserts none of the five
    surfaces still reach for `STATE.exercisePlan[`, `STATE.diet.mealPlan[`, `habitIsActiveOn(` or
    `scheduleExceptionForDate(` themselves. Agreement holds only while they read the model, so the
    test protects the mechanism rather than just the current output.

- **`navigateToEntity(type, id)`: one way to open any entity, from anywhere (2026-09-13).** The
  link primitive already had this logic inline; pulling it out as its own function made a latent
  bug obvious. The individual editors were the entry points, and several of them never navigated:
  `editNote()` and `editMeal()` set their screen's subtab and loaded the entity but left
  `NAV.currentTab` alone, so calling either from another tab opened an editor you could not see.
  Verified empirically before fixing ("tab after editNote from Budget: budget"). It stayed
  invisible because every caller at the time already happened to be on the right screen — an
  assumption a link chip breaks by definition, since a chip fires from whatever screen you are on.
  - **`ensureTab(tab)` rather than `switchTab(tab)`** everywhere a navigation might be a no-op.
    `switchTab()` pushes Back history and resets transient UI, so calling it unconditionally from
    an in-screen action (the pencil on a note card) would put a move that never happened on the
    Back stack. Order matters in the editors: `ensureTab()` must come *first*, because
    `switchTab('notes')` calls `resetTransientUi()` and would wipe the edit state set before it.
  - **Landing on the right screen is not the same as landing on the entity.** Destinations split
    into two shapes: editor screens (note, workout, meal) *are* the entity, so opening the editor
    loaded with it is the whole job; list screens (reminder, habit, charge, goal, activity) show it
    as one row among many, so `flashEntity()` stamps `data-entity="type:id"` on each row, scrolls
    it into view and pulses `--accent` for 1.4s. Scheduled past two `requestAnimationFrame`s
    because `render()` is rAF-deferred — the element does not exist yet when `open()` returns.
  - Writing the test found two handlers that did neither: the meal handler opened the meal builder
    screen without loading the meal, and the activity handler opened the schedule builder without
    opening the parent schedule the activity is nested inside — so in both cases you arrived and
    still had to go find the thing. Both now open the entity itself.

- **Recipe notes: a second kind of note, with structured ingredients and one-tap conversion to a
  Meal (2026-09-13).** A recipe is a distinct `Note.type === 'recipe'` rather than a tag — tags
  here are fully user-editable (renameable, deletable) and carry no behaviour, whereas a recipe has
  its own fields and its own action. Same precedent as a to-do being `Reminder.type`.
  - **Ingredients use the identical `{id, foodId, qty, unit}` shape as `Meal.items`**, which is the
    structural choice the whole feature rests on: converting a recipe into a Meal is a copy rather
    than a translation, and `computeMealTotals()` works on both unchanged. Recipes also carry
    servings, prep and cook minutes; the prose body underneath stays exactly what a note always was
    (method, photos, the story).
  - **Conversion asks every time, but only when there's a choice.** A multi-serving recipe offers
    ADD 1 SERVING / ADD WHOLE BATCH as two visible buttons; a single-serving one just offers ADD TO
    MEALS. Guessing wrong silently produces a Meal whose calories are Nx off everywhere they're
    shown or planned against, and the options are the point, so they aren't hidden behind a modal
    whose Cancel means "batch". Either way the new Meal is linked to its recipe, so the meal
    carries the macros and feeds the planner while the recipe keeps the method.
  - **Ingredient search is now word-based** — every typed word must appear somewhere in the name, in
    any order, so "breast chicken" finds "Chicken breast, cooked" where a strict substring never
    could. Deliberately no fuzzy/edit-distance matching: it surfaces confidently wrong suggestions,
    and "+ NEW INGREDIENT" is the honest escape hatch. `renderFoodSearchResults()` is shared, so the
    Meal Builder's own search improved for free.
  - **"+ NEW INGREDIENT" reuses the real Custom Foods form** as an overlay rather than a cut-down
    copy — that screen already collects and validates a food in exactly the shape `allFoods()`
    searches, including micronutrients a second form would omit. It renders over the Notes screen
    because navigating away would lose the in-progress note, whose title and body live only in the DOM.
  - **Ingredient edits patch their own container rather than calling `render()`.** The body is
    contenteditable and DOM-only, so a re-render mid-compose would silently wipe what's been
    written — the same reason `renderNotePhotoRow()` already patches. For the two places a real
    re-render is unavoidable (switching NOTE/RECIPE, and the ingredient overlay),
    `captureNoteDraftText()` parks the typed text and the form reads it back.
  - **A CSS specificity trap, third sighting.** `styles.css`'s `input[type="number"], select
    { width: 100% }` is specificity (0,1,1) and beats a bare class (0,1,0), so the quantity box went
    full-width, pushed the row past the panel edge and squeezed the ingredient name to nothing. Fixed
    with descendant-scoped selectors (0,2,0). Same trap CLAUDE.md documents for `.btn`/`.btn-primary`
    and that bit the edit-pencil highlight earlier this week.
  - `tests/test_recipe_notes.js` covers word-based matching (including a guard that the fixture
    isn't one a substring would already match), composing through the real form, the body surviving
    an ingredient add, persistence of every recipe field, the draft resetting so the next note isn't
    another recipe, both conversion paths and their arithmetic, the choice only appearing when it
    exists, reopening for edit, text surviving a type switch, plain notes staying entirely plain,
    notes predating the feature still rendering, and a reload.
- **Cross-entity links: one primitive replacing bespoke cross-feature wiring (2026-09-13).** The
  app was six well-built sections sharing one STATE and one render loop, where every connection
  between them was its own feature. Now any two things in the app can be marked as being about
  each other, and every screen renders that identically.
  - **One optional `links: [{type, id}]` on any entity, plus one registry.** `LINKABLE_TYPES`
    describes all eight linkable kinds (note, reminder, workout, meal, habit, charge, goal,
    schedule activity) in one table — how to list them, title them, subtitle them and open them.
    Adding a ninth type is one entry, not per-type UI anywhere.
  - **A link is ONE stored fact.** It lives on whichever side created it; the reverse direction is
    computed by scanning (`inboundLinks()`) rather than written to both entities. So the two halves
    of a connection can never disagree — the same drift that caused the navigation-leak and
    reset-list bugs fixed earlier today, avoided by construction rather than by discipline. At this
    data size the scan is free, and unlinking works from either end regardless of which side stores it.
  - **Untyped on purpose.** A link means "these are about each other", nothing more — no vocabulary
    to invent or keep consistent, and optional labels remain additive later.
  - **Chips carry their target's home-section colour** (`HOME_SECTION_META`), so which part of your
    life a connection points into is legible at a glance rather than needing to be read. The picker
    searches across every type at once — which is also the seed of the app-wide search idea, since
    it already indexes every entity by title.
  - **Deliberately not folded in:** `SavingsGoal.recurringChargeId`. That drives behaviour (ticking
    a charge's monthly box auto-creates a goal contribution), so it's machinery, not an
    association; a generic untyped link can't express it. `convertNoteToReminder` likewise stays a
    copy — it duplicates a note into a reminder and deliberately keeps no relationship.
  - Dead links degrade rather than break: a link to a since-deleted entity renders visibly dead
    instead of vanishing or throwing, so no cleanup pass is needed on every delete path — the same
    tolerance `scheduleForDate()` shows for an exception pointing at a deleted schedule.
  - `tests/test_entity_links.js` covers all eight types resolving with real section colours, the
    store-once/compute-reverse claim asserted directly (the non-creating side must store *nothing*),
    fan-out across every type, de-duplication from both directions, refused self-links, unlinking
    from either end, dead-link rendering, the picker's cross-type search and exclusions, a chip row
    present on all eight surfaces, closing on navigation, and persistence across a reload.
- **Survey item 6: the UI-state globals, consolidated onto three objects (2026-09-13).** The last
  and largest finding of the codebase survey — 82 module-level `let`s holding all UI state, 1,405
  references across 454 of 706 functions. Landed in three slices, each mechanical (same functions,
  same behaviour, same file) with the full suite green before the next began. **82 bare globals →
  21**, three of which are the new objects.
  - **`UI` — transient state (19 fields).** Everything meaning "a panel/form/picker is open" or "a
    mode is engaged". Built by `defaultTransientUi()`, which makes `resetTransientUi()` a single
    `Object.assign(UI, defaultTransientUi())`. That is the whole point: the defaults literal *is*
    the reset list, so the two can never drift — and two lists drifting is precisely how all 19
    came to leak across navigation in the first place.
  - **`NAV` — navigation position (20 fields).** Which tab, which subtab, which date each dated
    view is parked on. Separate from `UI` because it must *survive* a navigation, which is exactly
    why it can't live in the object a navigation resets. This also collapsed
    `navSnapshot()`/`applyNavSnapshot()`, which hand-mapped eleven globals to snapshot keys and
    eleven keys back with a renaming in between; one declared `NAV_SNAPSHOT_KEYS` array now drives
    both directions.
  - **`VIEW` — per-screen view state (26 fields).** Selections, filters, drafts, expanded/collapsed
    maps, clipboards. Session-only, and deliberately *not* reset on navigation: a half-built meal,
    draft photos or a notes filter should still be there when you return to that screen. Which
    object a field lives on now states that boundary explicitly instead of leaving it implicit.
  - **The 18 bare globals left are deliberate, not leftovers**: `STATE` (app data, not UI state),
    `REST_TIMER`/`AUDIO_CTX` (system resources holding live handles), `ACTIVE_FX`/`FX_LOAD_SEQ` (FX
    module runtime), `NAV_HISTORY`/`NAV_FORWARD` (the stacks themselves, not a position),
    `CLOUD_*` and `REMINDER_PUSH_*` (subsystem status), `MEAL_UNIT_SYSTEM` (a cache of a persisted
    setting) and `CHIP_DRAG`/`HOME_DRAG` (live objects that exist only mid-gesture).
  - `test_ui_state_reset.js` was rewritten to match: rather than a hand-kept table of flags, it
    dirties every key of `defaultTransientUi()` and asserts the object comes back deep-equal, and
    fails if `UI` carries a field the defaults don't — such a field would never be reset and would
    be invisible to the check. A flag added to the app is covered with no test change.
  - **This unblocks the `app.js` file split** that was the original motivation: 82 bare `let`s in
    one script scope cannot be divided across files, whereas three shared objects can.
- **Survey items 4, 5 and 7 — and a data-loss bug the refactor uncovered (2026-09-13).**
  - **`updateAllTMs()` split into `migrateState()` + `recomputeTMs()`.** The old name described
    its last few lines and hid the fact that ~200 lines of save migration ran on every visit to
    the Training Maxes screen, because `renderTMSetup()` called the whole thing. Harmless in
    itself — no `saveState()` inside, every step idempotent — but a migration on a hot render path
    is one careless edit away from writing on every frame. Boot calls `migrateState()`; renders
    call `recomputeTMs()` alone. The seam wasn't a clean cut: the `tmLb` recompute was interleaved
    inside a loop also doing migration, and it reads the `testType`/`conv` snapping done earlier in
    that same loop, so `migrateState()` finishes by calling `recomputeTMs()`.
  - **The bug that split exposed: importing a backup silently destroyed data.** `importData()` and
    the cloud-pull branch both did `STATE = Object.assign(defaultState(), data)` — a *shallow*
    merge, so an older save's `life` object replaced the default wholesale and took every field
    added since with it. Measured against the pre-fix build with a 2026-era backup: **8 of 8
    probed fields vanished** — habits, habit log, schedules, schedule exceptions, meal plan, saved
    meals, food log, budget goals. It had been survivable only by accident, because visiting
    Training Maxes re-ran the full migration and repaired it; removing that crutch is what made it
    visible. Both routes now adopt state exactly as boot does — write it, `loadState()` for the
    per-key merge, `migrateState()` for the backfills. `tests/test_state_adoption.js` checks all
    three routes against a deliberately antique save and carries a source guard so no future route
    can go back to a shallow assign.
  - **One canonical `Date` → `'YYYY-MM-DD'`.** There were three copies of the same concatenation —
    `todayStr()`, `fmtDateKey()` and `dateKey()`. Now `dateKeyOf(d)` wraps `dateKey()`, `todayStr()`
    is `dateKeyOf(new Date())`, `fmtDateKey()` is gone, and the one remaining hand-built date string
    (the month-end contribution date in the budget goal sync) uses `dateKey()` too. Local time
    throughout, deliberately — `toISOString()` would report tomorrow's date on an evening in a
    negative-offset zone.
  - **Two test assertions repointed at the app constants they were really asserting** —
    `test_agenda` reads `AGENDA_DAYS`, `test_recurring_reminders` reads `RECURRENCE_HORIZON.monthly`.
    Both would otherwise have failed as "expected 7, got 10" the day those were tuned, blaming a
    stale literal for a deliberate product change. `test_calendar_day_union` now asserts its six
    rows by name rather than by total (a total says nothing about *which* six, and breaks if the
    band gains a group), and `test_activity_overlaps` checks an exact array, matching the two
    sibling assertions beside it.
- **Codebase survey — all seven findings landed (2026-09-13).** Three fixed immediately here;
  the other four (`updateAllTMs()`, the date-key dedup, the test-assertion audit, the globals
  consolidation) landed the same day as their own entries elsewhere in this changelog — see
  "Survey item 6" and "Survey items 4, 5 and 7". A
  full investigation of `app.js` (11,270 lines, 706 functions, 46 test files) for bugs,
  limitations and refactorable code. Clean bill of health on several fronts worth knowing: **0
  dead functions** (checked against markup, `sw.js`, the reminder worker, every FX module, and
  tests), all 5 swallowed `catch {}`s benign, all 7 off-render-path `innerHTML` writes legitimate
  owned-container patches, 0 TODO/FIXME markers. Three findings were fixed:
  - **Every transient UI flag leaked across navigation — all 15, verified empirically.** Each
    "a form/picker/modal is open" or "a mode is engaged" flag is a module-level `let`, and none
    was reset on leaving its screen, so a half-open reminder form abandoned on the Calendar was
    still open a day later, and Home's edit mode survived a trip to Exercise. Three instances had
    already been patched locally that week; `resetTransientUi()` now fixes the family, called at
    the four points where the top-level tab actually changes (`switchTab()`, `applyNavSnapshot()`
    for Back/Forward, and the direct `CURRENT_TAB` assignments in `openSetup()` and
    `openTodayWorkout()`). **Deliberately at navigation time, not inside `_doRender()`**: a
    render-time hook would catch every future nav path for free, but `render()` is rAF-deferred,
    so it would close a form that `switchTab(); toggleReminderForm()` had just opened in the same
    tick — a sequence existing tests already rely on. Two boundaries pinned by the test: content
    drafts with their own lifecycle (`MEAL_BUILDER_DRAFT`) are *not* wiped, and in-tab moves don't
    reset anything. The probe reads the real script-scope bindings via `new Function` — a
    `window[name]` probe reads back its own write and passes vacuously, which is how a first draft
    of the survey nearly reported nonsense.
  - **All 35 literal-id `getElementById(...).value`/`.checked` reads were unguarded, and the
    typechecker can't see it** — `types/app.d.ts` widens `HTMLElement` with `value: any` (its own
    comment calls this a known blind spot), so a wrong or not-yet-rendered id compiles clean and
    throws at runtime; exactly how `saveReminder()` crashed mid-save when `#remEndTime` didn't
    exist yet. `inputVal()`/`inputChecked()` return `''`/`false` for an absent element; the 35
    reads were replaced mechanically (the 4 `.value =` *assignments* aren't the hazard and were
    left). `test_input_helpers.js` carries a static guard that reads `app.js` and fails the suite
    if a bare read creeps back in, plus the original crash as a regression.
  - **The suite's recurring flakiness — 284 fixed `waitForTimeout` sleeps racing the app's
    rAF-deferred render.** Runs are sequential, so it was never parallelism: purely timing under
    load, the "one random file fails, passes on rerun" seen ~6 times in one day. `tests/helpers.js`
    now exports `settle(page)` (two `requestAnimationFrame`s — exactly when `_doRender()` has
    painted), swapped in for every sleep ≤350ms across all 48 files. The 10 sleeps ≥500ms are
    **real-timer** waits (toast auto-hide, scroll-indicator fade, rest timer, FX animations) and
    were left alone; `tests/README.md` documents the rule. Verified by three consecutive full-suite
    runs — and as a bonus the suite went from ~137s to ~89s, since the sleeps were ~50s of dead
    waiting per run. One mis-categorisation surfaced on the first run and is worth remembering:
    `test_home.js` read the edit-pencil's computed border immediately, and `styles.css` gives
    `.icon-btn` a 150ms border-colour *transition* — the old 150ms sleep had matched it by pure
    luck. That assertion now waits on the actual condition via `page.waitForFunction`, so the
    cascade bug it guards would time out loudly rather than pass mid-transition.
- **Time rollup: "where the week went" (2026-09-13).** The last item of the scheduling build-out.
  Needed a data-model change first — activities and anchors had no category, so "hobbies got 4h
  this week" couldn't be grouped that way at all.
  - **Categories are the five non-Schedule Home sections**, the person's own idea and a better one
    than a free-text field: `timeCategories()` reads ids, labels and colours straight out of
    `HOME_SECTION_META`, so the rollup matches the Home tiles automatically and invents no new
    vocabulary for the areas the app already tracks. Schedule itself is excluded — it's the
    container everything sits in, not an area you spend time *on*.
  - **Plus four extras** (`EXTRA_TIME_CATEGORIES`: work, sleep, social, chores), added after
    flagging that the five sections alone leave the biggest blocks of a real day homeless — Work is
    typically 8h and fits none of them, and sleep would have to masquerade as Health and drown it.
  - **Only categorised time counts.** Untagged blocks are left out entirely rather than lumped into
    an "other" pile that Work and sleep would dominate. This reframes the feature as "did my life
    areas actually get time this week" rather than "where did all 168 hours go" — which is the
    question actually worth asking, and it's why nothing is auto-tagged. Also flagged at scoping
    time: tagging the default anchors thoroughly would make HEALTH ~90% of the chart (sleep, meals,
    skincare, wind-down all land there), so leaving most of them untagged is the intended default.
  - **Lives in the Calendar's WEEK zoom**, which needed no new nav and gave that zoom a purpose it
    was missing — it had been a 7-cell copy of Month with nothing to distinguish it, noted as a
    weakness in the original review that kicked off this whole build-out.
  - Overlapping blocks each count their own duration (a 30-minute Lunch inside an 8-hour Work block
    contributes to both), so the totals deliberately don't sum to elapsed time. Each category's own
    figure is what's being asked about, and nothing claims they tile a day.
  - **Wake-Up and Bed Time carry their own categories** (`wakeCategory`/`bedCategory` on the
    schedule). Found while testing: Bed Time is a schedule-level field rather than an activity, so
    without this the SLEEP category would have sat in the picker permanently unreachable.
  - `tests/test_time_rollup.js` covers the category set (sections reusing their own colours,
    Schedule excluded, the extras present), hand-computed weekly totals across a Mon–Fri schedule
    plus every-day anchors, untagged time contributing nothing anywhere, SLEEP being reachable, a
    day-off exception subtracting exactly that day's schedule blocks while its anchors survive,
    overlapping blocks counting independently, longest-first ordering, the empty state, and all
    three editors persisting and clearing a category.
- **Agenda: the next 7 days, forward-looking (2026-09-13).** From step 4 of the scheduling
  build-out. Every other calendar view answers "what does this one day look like" — you had to walk
  forward a day at a time to find out what was coming. A third Schedule subtab
  (HOME / CALENDAR / AGENDA / SETUP) answers "what's coming up".
  - **Shows only what's *distinctive* about each day**, which is the whole design decision.
    Enumerating every anchor across seven days would repeat the morning routine seven times and
    bury the one dentist appointment that's actually news. The recurring baseline is summarised as
    a single schedule-name + booked-hours line per day; the Day view stays the place to see a day
    in full. A day with nothing notable collapses to just its header line, so the week's shape
    stays readable.
  - Lists dated events and reminders (timed ones sorted by time, untimed after, recurring ones
    marked with the repeat icon) plus planned workouts. An excepted day shows its label in
    `var(--warn)` **and** still reports booked time — a day off whose anchors are still running
    isn't empty, and dropping the figure would hide that. A day off pauses planned workouts here
    too, matching the rule the Day view's untimed band already uses.
  - Tapping any day opens it in the Calendar's Day view. This needed a fix to
    `calSelectDayAndZoom()`, which set the zoom and selected date but not `SCHEDULE_SUBTAB` — from
    the Agenda's own subtab that would have re-rendered the Agenda, making the tap look dead. It
    was only ever called from the Year grid before, which is already on the Calendar subtab.
  - `tests/test_agenda.js` covers the 7-day window and its boundaries (nothing from the past,
    nothing beyond the window), today/tomorrow labelling, distinctive items appearing while the
    recurring baseline is explicitly *not* enumerated, exception labelling across a multi-day
    range with booked time retained, a day off pausing planned workouts, the recurring-reminder
    marker, the day-tap actually landing on a rendered Day view, and graceful degradation with
    nothing configured at all.
- **Overlap detection between the things in a day, with an "open block" escape hatch
  (2026-09-13).** From step 4 of the scheduling build-out. Nothing caught two things colliding at
  2pm within a day — the Week At A Glance strip only ever caught two *schedules* claiming the same
  weekday.
  - **The design problem, and the person's own answer to it.** Overlapping is normal, not
    automatically a mistake: a 30-minute Lunch sits inside an 8-hour Work block by design (the
    Day-view prototype built for step 1 had exactly that). The version offered was a heuristic —
    flag partial overlaps, stay quiet on full nesting — and the person proposed something better
    instead: let a block be marked **open**, a declared container other things are *expected* to
    sit inside, exempting it and anything overlapping it. Explicit intent beats inferring from
    geometry, and it also fixes cases the heuristic would still have got wrong (a meeting
    legitimately running a few minutes past Work's end is a partial overlap, not a clash).
  - `open` is a flag on anchors and on schedule activities, set by a checkbox in Set Anchors and
    in the Schedule Builder. Two non-open blocks sharing any minute is a genuine collision;
    `dayOverlapWarnings()` returns block id -> the labels it clashes with, and the Day timeline
    shows a `var(--warn)` `OVERLAPS <name>` chip naming the other side (named rather than a bare
    "clash" marker, since there's no hover on a phone to reveal it).
  - An open container does **not** excuse two real things clashing *inside* it — Call 10:00-11:00
    and Meeting 10:30-11:30 inside an open Work block are still both flagged. Only overlaps
    *with* the open block itself are forgiven.
  - Half-open intervals, so blocks that merely touch (one ending exactly as the next begins) never
    count as colliding; `blockDaySegments()` splits a midnight-crossing block into two segments so
    the wrap can't hide or invent a collision.
  - `tests/test_activity_overlaps.js` covers the segment math including the midnight split,
    touching-vs-overlapping, the open-block rule in both directions (silencing a deliberate
    nesting, and still catching a real clash inside an open container), multi-way collisions,
    zero-length blocks, the flag flowing from stored anchors/activities into the day's blocks, the
    rendered chips, and both editors persisting the flag.
- **Schedule exceptions: date-range overrides of the weekday templates — step 3 complete, and with
  it the scheduling build-out's main arc (2026-09-12).** A schedule was a weekday template with no
  way to say "this particular Tuesday is different" — a holiday, a vacation week, a sick day.
  Scoped with four questions first, and the fuller option was chosen on every one, so this is
  noticeably bigger than the minimal version that was offered.
  - **`scheduleForDate()` turned out to be a single chokepoint** with three callers (the Day
    timeline via `scheduleBlocksForDate()`, the Month/Week grid's schedule icon, the Year grid's
    dot), so overriding inside it propagates to every calendar view automatically with no
    per-view changes.
  - **The semantic, worth keeping straight:** anchors are the permanent baseline, everything else
    is "the plan". A **day off** (`scheduleId === null`) cancels the plan — no schedule, and
    `renderDayUntimedItems()` pauses planned workouts, meals and habit prompts too — while anchors
    keep running unless the exception also sets `skipAnchors`. A **swap** (`scheduleId` set) is
    *not* a day off: it's a differently-shaped day, so the untimed band is left completely alone.
    **Dated one-off events are never suppressed by either** — a dentist appointment booked for a
    holiday is still a real appointment, and exceptions only override the weekday *template* world.
  - Stored as explicit `startDate`/`endDate` ranges (`STATE.life.scheduleExceptions`), so a week
    off is one row rather than seven. Overlapping ranges resolve first-match-wins, the same
    convention `scheduleForDate()` already used for two schedules claiming one weekday. A backwards
    range is normalised on save rather than stored where it can never match, and editing either end
    past the other carries the other end along. A swap pointing at a since-deleted schedule
    degrades to a day off rather than silently falling back to the template it was meant to
    override.
  - **Two entry points, on purpose**: created from the Calendar's Day view (where you're standing
    when you decide a day is different — `renderDayExceptionControl()`, which also shows a
    `var(--warn)` banner explaining what's in effect plus a REMOVE button), and reviewed/cleared
    from a new EXCEPTIONS tab under Schedule → Setup, which is the only place to see them all at
    once. `scheduleExceptionEffect()` generates the one-line description for both, so the two
    surfaces can't drift apart in wording.
  - Note that the Week At A Glance strip in Schedule Builder deliberately does *not* reflect
    exceptions — it's a weekday-template overview, and exceptions are date-based.
  - **Fixed a rotted test fixture found by this change**: `test_ui_polish.js` used Schedule Setup
    as its example of a *non-overflowing* sub-nav ("2 tabs", per a comment already stale by one
    tab), so adding the EXCEPTIONS tab made it overflow and the assertion failed. The behaviour
    under test was fine; the fixture had drifted into testing a tab count. It now builds a
    two-button strip from `subNav()` directly and asserts the fixture genuinely doesn't overflow
    before checking that no affordances show, so it can't rot the same way again.
  - `tests/test_schedule_exceptions.js` covers range inclusivity at both ends, first-match-wins on
    overlap, all four `scheduleForDate()` outcomes (day off / swap / deleted-swap / fall-through),
    `skipAnchors`, dated events surviving an exception, the untimed band pausing on a day off but
    not on a swap, creation through the real Day view form, backwards-range normalisation,
    coherent range editing from either end, delete, reload persistence, and a pre-feature save
    backfilling to an empty array.
- **Recurring reminders: annual + monthly — first half of step 3 of the scheduling build-out
  (2026-09-12).** Scoped explicitly before building: step 3 turned out to be two unrelated
  data-model changes (recurring reminders vs. schedule single-day exceptions), so it was split
  and only the reminders half was built now. Materialized, not virtual: setting a recurrence
  immediately generates real, independent `Reminder` rows for the next several occurrences
  (`ensureRecurringReminderOccurrences()`), rather than storing a rule and computing instances on
  the fly. The tradeoff, chosen deliberately over the virtual alternative: every existing reminder
  code path — `remindersOn()`, `scheduleBlocksForDate()`, the Month/Year calendar dots, push sync —
  needed zero changes, since a generated occurrence is just an ordinary `STATE.reminders` entry.
  The cost is there's no "edit changes all future occurrences" — editing or deleting any one
  occurrence only ever touches that single row, exactly like any reminder today.
  - **Occurrence dates are computed from the series' own unchanging anchor date**, not by rolling
    forward from the previous occurrence — a monthly reminder anchored on the 31st lands on the
    31st whenever the target month has one (Jan 31 → Feb 28 → Mar 31 → Apr 30 → May 31…), rather
    than permanently drifting down to the 28th the first time a short month clamps it. Same
    clamping convention for annual on a leap day (Feb 29 → Feb 28 in non-leap years, back to
    Feb 29 whenever the target year is one).
  - **Idempotent by construction**: deterministic `${recurrenceId}_r${n}` occurrence ids mean
    `ensureRecurringReminderOccurrences()` — called right after creating a recurring reminder, and
    on every app load — never duplicates a row. Deleting every remaining occurrence in a series
    (there's no dedicated "cancel series" action) is genuinely how it stops, since top-up only
    ever extends forward from whatever's still there.
  - Horizon of 2 future occurrences for annual, 6 for monthly — enough to always show something
    coming up without materializing years of monthly rows. Only `type: 'reminder'` can recur; a
    recurring to-do's per-occurrence checklist-reset semantics are a distinct feature, deliberately
    not built here.
  - **Fixed along the way**: choosing REPEATS after typing a title would have silently wiped it —
    the REPEATS toggle sits below Title (unlike the existing REMINDER/TO-DO toggle above it, which
    is always tapped before anyone's typed anything, so its identical defect was never actually
    hit in practice). `REMINDER_FORM_DRAFT` now captures the open form's fields before any toggle
    forces a re-render, and the fresh inputs restore from it.
  - A recurring reminder's card shows a `↻ Repeats annually/monthly` line and its delete
    confirmation names the cadence, so it's never a mystery why a reminder nobody directly typed
    is sitting on some future date.
  - `tests/test_recurring_reminders.js` covers the date-clamping edge cases by hand, materializing
    on creation via the real form, the draft-preservation fix, idempotence across redundant
    top-up calls, a deleted occurrence staying deleted (and a fully-deleted series staying
    stopped) after re-running top-up, a to-do never acquiring a recurrence even if REPEATS was
    touched first, the card badge, the delete-confirm wording, and `remindersOn()` picking up a
    generated occurrence for free.
- **Calendar Day view now shows the untimed half of a day too — step 2 of the scheduling
  build-out (2026-09-12).** The Day view knew only about anchors, schedule activities and
  reminders, so three things that are unambiguously part of "what's going on this day" never
  appeared on the Calendar at all: planned workouts, planned meals, and habits.
  - **The design finding that shaped this:** none of the three carry clock times.
    `exercisePlan[weekday]` entries are `{id, workoutId}`, `diet.mealPlan[weekday]` entries are
    `{id, mealId}`, and a habit mark is a per-date flag. So they can't be chronological timeline
    blocks the way step 1's dated events could — inventing times for them would have been a lie.
    They render instead as a day-level band (`renderDayUntimedItems()`, "ALSO TODAY" / "ALSO THIS
    DAY") below the timeline, grouped by source with the same colour language as the rest of the
    calendar. The whole band is conditional — a day with none of these renders nothing, matching
    the Home boxes' convention rather than showing an empty panel every day.
  - **A planned workout's "logged" state is looked up by the date being viewed, not by
    `STATE.currentCycle`.** Workout logs are keyed `${cycle}_${workoutId}` but carry their own
    `date`; the Day view can show any date, and the current cycle says nothing about whether a
    workout was done on that particular day. `workoutIdsLoggedOn(dateStr)` does that lookup.
  - Habits are markable on whatever date is being viewed, not just today — `toggleHabitOn(id,
    status, dateStr)` generalises the old `toggleHabitToday()` (kept as a thin wrapper, since
    Home's habits box genuinely always means today). Exactly the arrangement
    `toggleDailyAnchor(id, dateStr)` already used, and the point of being able to look back at a
    day you forgot to log.
  - **Scope deliberately confined**, at the person's direction: Day view only (Month/Week grid
    cells already carry a day number, a schedule anchor icon and a reminder dot at ~44px, so
    more marker types there needs its own look first), and budget charges left out because they
    have no due-date data to surface — see the note under Ideas.
  - `tests/test_calendar_day_union.js` covers the conditional empty band, all three groups
    rendering with their states (logged workout, kept habit, unmarked habit), marking a habit on
    a past day without touching today, `workoutIdsLoggedOn()`'s date-scoping (a log under a
    different cycle on a different date must not leak), and a habit past its end date dropping out.
- **Fixed: sub-nav strips snapped back to the start the instant you tapped a button in them
  (2026-09-12).** Reported directly against Exercise Setup's GENERAL tab, but the bug lived in
  the shared `subNav()`/`attachSubnavScrollAffordances()` system (see
  `subnav-scroll-affordances` memory) — every render fully replaces `#app`'s innerHTML, so a
  `.subnav-wrap`'s `.subnav` element is a brand-new DOM node on every single render, including
  the one triggered by tapping a button inside that very strip, and a brand-new node's native
  `scrollLeft` starts at 0. Scroll a strip over to reach an off-screen button, tap it, and the
  whole strip visibly jumped back to the start even though the tap itself never scrolled
  anything.
  - Fixed with a small `_subnavScrollMemory` `Map`: `_captureSubnavScroll()` runs at the very
    top of `_doRender()`, before any `innerHTML` assignment, and records every current
    `.subnav-wrap > .subnav`'s `scrollLeft`. `attachSubnavScrollAffordances()` (already called
    after the new DOM exists) writes the remembered value back onto the new node before
    computing its chevron/scrollbar visibility, so there's no visible flash and the affordance
    state is correct on the very first paint.
  - Keyed by the strip's own button-label text (`nav.textContent`) rather than DOM position —
    navigating to a different screen can put an unrelated sub-nav in the same structural slot,
    and a position-based key would have leaked that sub-nav's scroll offset onto this one.
    Distinct sub-navs always have distinct labels, so this can't collide.
  - Fixes all 6 `subNav()` call sites at once (Exercise Setup, Progress, Notes, Schedule/Health
    Setup) — this was never specific to GENERAL, just most visible there since it's the tab
    furthest from view.
  - `test_ui_polish.js` gained two cases: a real click on GENERAL preserves both scroll position
    and chevron state through the resulting re-render; switching to a different, unrelated
    overflowing sub-nav (Progress) starts at 0 rather than inheriting Exercise Setup's leftover
    offset — the cross-contamination guard the text-keying is specifically for.
- **Home edit mode's pencil now turns `var(--warn)` while active — and this surfaced a real,
  previously-dormant styling bug (2026-09-12).** The person asked for the pencil to change color
  in edit mode for clarity; investigating found it technically already had an "active" rule
  (`.home-edit-toggle-active`, tinting it `--accent`) that had **never once actually rendered**,
  on any build, since it was written. `.home-edit-toggle-active` and `.icon-btn` carry identical
  specificity, `.icon-btn` sits later in `styles.css` and sets its own background/border/color, so
  it silently won the cascade every time — the exact CSS gotcha CLAUDE.md already warns about
  elsewhere, just not yet caught here. The existing test only checked the class was *attached*,
  never what it actually rendered as, so this shipped invisibly for as long as the feature existed.
  - Fixed by writing the selector as `.icon-btn.home-edit-toggle-active` (specificity now wins
    outright, independent of file order) and switching the color itself to `var(--warn)` — pink
    accent sitting right next to the accent-colored Settings gear and accent-colored wordmark made
    "you're in edit mode" nearly unreadable even once the rule did fire; `--warn` reads as "this
    changes your layout" and stands apart from the rest of the chrome. Checked on Terminal (bright
    lime glow) and Editorial (a legible ochre-brown on cream) as well as the default aesthetic.
  - `tests/test_home.js`'s existing edit-button assertion was rewritten to check the *computed*
    border color against a live `var(--warn)` probe rather than just `classList.contains(...)` — a
    plain class check is exactly what let the original bug hide for this long, so it needed to
    actually verify the rendered color to mean anything. Also fixed, incidentally: that same test
    file's RIGHT NOW/"FREE TIME" assertions relied on no default anchor being active, which depends
    on the wall-clock time the suite happens to run at (several default anchors span hours of the
    morning and evening) — clearing `STATE.life.anchors` before those assertions and restoring them
    after makes the test deterministic regardless of time of day, rather than failing for several
    hours out of every day for reasons unrelated to whatever change is actually being tested.
- **Past-due reminders get a glowing exclamation mark (2026-09-12).** `reminderIsPastDue()` +
  `pastDueMark()`, shown on both surfaces a reminder appears on — the Calendar reminder card and
  Home's TODAY'S REMINDERS list.
  - Measured against `endTime` when there is one, not the start: a 2-3pm dated event is *happening*
    at 2:30, not overdue, and marking it late there would directly contradict the Day timeline's
    own `NOW - 30m LEFT` chip on the very same block.
  - A reminder with no time at all is an all-day thing — not late until the day is over, rather
    than from the moment the day starts.
  - A to-do whose every item is ticked is finished whatever the clock says (an *empty* checklist
    still counts as outstanding). Nagging about a completed list would just be noise.
  - Takes the active aesthetic's own `var(--warn)` and **pulses** (a 1.6s `text-shadow`/opacity
    breath). Both were a deliberate call by the person, overriding a first pass that used a fixed
    yellow-orange and a static glow on the reasoning that `--warn` swings from lime (`#e8ff5b`) to
    muted brown (`#b8863a`) across the aesthetics. Belonging to the theme won over reading
    identically everywhere — worth remembering as this project's general preference when the two
    conflict. Checked at both extremes: it glows clearly on Terminal's near-black and stays legible
    as ochre on Editorial's cream. The glow is built from `currentColor`, so it follows `--warn`
    with no per-aesthetic rule to maintain, and `prefers-reduced-motion` holds it at a steady glow.
  - `tests/test_reminder_past_due.js` covers 13 date/time/type combinations (built by offsetting
    the real clock rather than mocking it), both render surfaces, and the computed colour, glow and
    animation — asserted against the *resolved* `--warn` rather than a hardcoded value, and
    re-checked after switching aesthetic, so it's the linkage being tested rather than a magic
    number. A dropped stylesheet rule fails rather than silently shipping an unstyled character.
  - **Fixed the same day:** the test's own offset helper (`at(offsetMin)` — "90 minutes from
    now") built an HH:MM string but always dated the reminder `todayStr()`, which is wrong
    exactly when the offset crosses local midnight (e.g. at 22:36, "90 minutes from now" is
    00:06 *tomorrow*, not a late-night time today) — `reminderIsPastDue()` correctly read the
    numerically-small resulting time as already past, given that malformed input, and the test
    failed for real, deterministically, for a ~3-hour window around local midnight every day.
    Not caught immediately because the suite doesn't happen to run in that window often. Fixed by
    clamping every case's target minute-of-day into `[1, 1439]` on `todayStr()` rather than
    letting an add/subtract wander across a date boundary — none of these cases care about the
    exact elapsed real time, only "clearly before/after now, same day."
- **Dated one-off events, and a Day timeline that shows duration (2026-09-12).** Came out of a
  review of what this app's scheduling was missing next to general calendar apps. The structural
  finding: everything in Schedule was a *weekday template* (anchors, schedules, `exercisePlan`),
  so a specific appointment — "dentist, Oct 3, 2–3pm" — had nowhere to live that actually occupied
  time. Reminders were the only dated thing, and a reminder is a point, not a block.
  - **A Reminder with both `time` and a new optional `endTime` is now a dated event.**
    `scheduleBlocksForDate()` merges it into the day's blocks as `kind: 'event'`, which means it
    lands in Calendar → Day *and* in `currentScheduleBlock()` — Home's RIGHT NOW card can say
    "Dentist" with no wiring of its own. A reminder with no `endTime` behaves exactly as it always
    did (list + push only, never a block), so **no migration is needed** for existing saves.
    Deliberately grew Reminders rather than adding a separate Events type: no new concept to learn,
    push already works on it, and the inline-editable reminder card is already a good editing
    surface. Clearing a reminder's start time clears its end with it (an end alone has nothing to
    measure from, and is dropped at save time too).
  - Events stay listed in the day's reminder list as well as appearing in the timeline — the
    established convention already (anchors show in the timeline but are edited under Setup;
    schedule activities show but are edited in Schedule Builder). The card gains a small "on your
    day's schedule" line so the relationship is legible.
  - **The Day timeline (`renderDailySchedule()`) was rebuilt to make duration legible.** Chosen
    over a to-scale hour grid after building both and comparing screenshots: the list fits a whole
    day on one 390px screen (~680px vs. ~970px), and anchor check-off keeps a full-size tap target
    that a 22px-tall 30-minute block in a time grid can't offer. A time grid's real advantage —
    showing that one block sits *inside* another — matters most for dense overlapping meetings,
    which isn't the shape of this app's day. Revisit as an optional zoom if that changes.
    - Per-block duration bar, square-root-scaled (`14 + sqrt(d/max) * 28` px) so an 8-hour block
      reads as clearly longer than a 30-minute one without dragging a near-empty row 100px tall.
    - Colored by `BLOCK_KIND_META` — fixed per kind (a known, closed set), same
      fixed-identity-vs-rotating-palette distinction as `HOME_SECTION_META` vs. `scheduleColorFor()`,
      drawn from the same palette family as the calendar's schedule colors.
    - Unscheduled stretches of 30+ minutes are named outright ("2h 30m free") instead of being
      absent. Computed against a running coverage watermark, so a block nested inside a longer one
      never opens a phantom gap.
    - A booked/unscheduled total per day, via `dayBookedMinutes()` — an interval **union**, not a
      sum, since blocks overlap constantly and summing would report more than 24 hours.
    - The current block gets a `NOW · 40m LEFT` chip. It's identified by calling
      `currentScheduleBlock()` and comparing ids rather than re-deriving "what's on now", so the
      Day view and Home's RIGHT NOW card can never disagree. A list can't draw a now-*line* inside
      a block honestly — above the current block would read as "now is before this" — so the badge
      carries the remaining time instead, which a line couldn't tell you anyway.
  - `tests/test_dated_events.js` covers the block-merge rules (both times required, other dates
    excluded, legacy reminders untouched), `blockDurationMinutes()` across midnight,
    `dayBookedMinutes()`'s union against hand-computed overlap/nesting/disjoint/clipped cases, the
    real save form, inline editing, start-clears-end, RIGHT NOW picking up a live event (bracketing
    the real clock rather than mocking it), the NOW chip and EVENT badge rendering, gap math around
    a nested block, and persistence across a real reload.
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
  inside `.home-edit-box` while home edit mode is on (`UI.homeEditMode`, formerly `HOME_EDIT_MODE`),
  excluding the hide (X) button so that
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
