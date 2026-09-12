# LIFEMan.EXE — Project Overview

## What this is

**LIFEMan.EXE** (page title: *"LIFEMan.EXE — P-Zero Tracker"*) is a local-first personal
life-tracking web app (a PWA — installable to a phone's home screen, works offline). It ships as
three files — `index.html` (a ~90-line shell), `styles.css`, and `app.js` (~10k lines, one big
classic `<script>` so its functions stay global for inline `onclick=` handlers) — plus a
`aesthetics/` folder holding the CSS (and, for a few, a small compiled TypeScript effects module)
for whichever visual themes aren't cheap enough to ship to everyone by default. There's no
bundler and no build step for the app itself; the one thing that *is* compiled is the handful of
per-aesthetic effects modules (`aesthetics/<key>/fx.ts` → committed `fx.js`), via a one-line
`npm run build:fx`.

`localStorage` is the primary store, but it's no longer the *only* one: two genuinely optional,
off-by-default backend integrations exist for the person who built this —

- **Cloud Sync** (Firebase Auth + Firestore) — cross-device sync, one JSON blob per user,
  last-write-wins.
- **Web Push reminders** (a small Cloudflare Worker, `reminder-worker/`) — real system
  notifications for Reminders, since the web has no working local-notification-scheduling API on
  iOS.

Both are inert until explicitly turned on in Settings; with both off, the app behaves exactly as
a plain offline `localStorage` app always did, with manual JSON export/import as the fallback.

It's built for one person's actual daily use — not a generic multi-user product — and covers six
life domains from one bottom-tab-navigated mobile-first interface:

1. **Exercise** — structured strength + cardio training programs, workout logging, and a Progress
   tab (body weight, body measurements, per-muscle set volume, and a COMPARE view that charts
   real logged lift history — top set, not the programmed target — alongside body weight)
2. **Schedule** — fixed daily "anchors," a schedule builder (named, day-of-week-assigned
   schedules, each with wake/bed times and activities), and a Calendar with four zoom levels
   (Year → Month → Week → Day) that also surfaces which named schedule covers which day and
   merges in Reminders (including a checklist/"to-do" reminder type) for whichever date you're on
3. **Hobbies** — currently guitar practice tracking (chords/songs/technique/practice log)
4. **Health & Diet** — daily weight logging (with optional body-fat %/body-water % and a 7-day
   trailing-average trend line), body measurements, a food database with a per-day diet log, meal
   planning (with a shopping-list generator that turns a week's planned ingredients into a
   checklist Reminder), and TDEE tracking — both a static formula calculator and a rolling,
   adaptive estimate derived from actual weight trend vs. calories logged, with an optional
   cardio-calorie breakdown of that same number
5. **Notes** — a tagged, rich-text journal with photo attachments; any note can be turned into a
   Reminder in one tap
6. **Budget** — recurring income/bills (bills can be flagged as savings/investment, with their own
   reserved slice and a monthly contribution checkbox), one-off incidental spending, and a Goals
   tab — named savings targets (one-time or annual-resetting) with a running balance, fundable by
   hand or by linking a goal to a recurring savings bill

The whole app is reskinnable via **23 selectable visual aesthetics** (see `ARCHITECTURE.md`) —
this was explicitly designed as a fun, personal touch, not just a light/dark toggle, and the
aesthetic system is treated as an ongoing, still-growing feature area in its own right.

## Who it's for / how it's used

Built and actively used by one person as their daily driver for training, habits, budgeting, and
journaling. Development happens conversationally with Claude Code: the person describes a feature
or a tweak in plain language, a session implements it directly against the real files in this
repo, runs the Playwright test suite (`npm test`) and `npm run typecheck`, and — once asked to —
commits and pushes. The app is deployed via **GitHub Pages** straight from this repo (no separate
build/deploy pipeline; `index.html` at the repo root pulls in `styles.css`/`app.js` as-is), and an
installed PWA self-updates by comparing a build-stamp meta tag on every launch/foreground.

There is no ticket tracker or issue backlog outside of conversation — `ROADMAP.md` in `docs/` is
the closest thing to one, and it's kept current as ideas come up and get built (or explicitly
deferred — see its "Ideas worth considering" section, which is a running list, not a request
queue).

## Design philosophy (things worth preserving in future changes)

- **No build step for the app itself.** `index.html`/`styles.css`/`app.js` ship exactly as
  written — no bundler, no npm dependency shipped to the client (Chart.js and Firebase load from
  a CDN as plain globals, the same pattern either way). The one deliberate exception is the small
  compiled TypeScript layer for per-aesthetic effects modules — see `ARCHITECTURE.md`.
- **Local-first, no account required.** All data lives in `localStorage` on the device by
  default. Cloud Sync and Web Push reminders are both genuinely optional, opt-in additions on top
  of that — never a requirement — and manual JSON export/import (Setup → Data) remains the
  always-available fallback regardless of what else is turned on.
- **Config-style editing, not modal forms.** Most editable lists (recurring charges, categories,
  schedule anchors, savings goals) render as always-visible, inline-editable rows rather than
  "open a dialog to edit" — consistent with the rest of the UI. Keep new editable lists in this
  style.
- **Personality over neutrality.** The aesthetic system, custom SVG icon set, and playful copy
  (tab labels, empty states) are core to the experience, not decoration bolted on afterward. A
  new feature should get its own icon and read naturally within at least the default aesthetic
  before considering how it looks in the other 22.
- **Mobile-first, thumb-reachable.** Primary nav is a bottom tab bar; screens assume a narrow
  viewport first (390px is the standard test width, but real devices have gone narrower — a
  design that only just fits 390px in a sandbox has bitten this project before, see the Calendar
  Year view's column count in `ROADMAP.md`). Anything added to the bottom bar must account for it
  becoming horizontally scrollable once a section has more sub-tabs than fit.
- **Prefer linking existing features over adding new standalone ones**, when the same real-world
  thing already lives in two places (a savings goal and the monthly budget; a meal plan and a
  shopping list; a note and a reminder). See the "Cross-feature linking" entries in `ROADMAP.md`
  for the running list of what's been connected and what's still just an idea.

## How this project is organized

- **`CLAUDE.md`** (repo root) — the actual day-to-day working reference: file layout, the
  aesthetic/FX-module system in full technical detail, type-checking conventions, testing/deploy
  workflow, and a running "known issues" list. Read this first when starting work in this repo.
- **`docs/PROJECT_OVERVIEW.md`** (this file) — what the app is and why it's built this way; the
  high-level view, not implementation detail.
- **`docs/ARCHITECTURE.md`** — how the code is structured: the render model, the CSS
  design-token/aesthetic system, the SVG icon system, and testing conventions in depth.
- **`docs/DATA_MODEL.md`** — the full shape of `STATE` (the one object that is the entire app's
  data, defined in `app.js`'s `defaultState()` and mirrored in `types/app.d.ts` for the type
  checker).
- **`docs/ROADMAP.md`** — known limitations, ideas raised but not yet built, and a "Recently
  shipped" changelog. Move a feature there once it ships; don't treat the ideas section as a
  request queue.
- **`TESTING_CHECKLIST.md`** (repo root) — the small set of things that can only really be
  verified on a real device (push notification delivery, etc.), since a sandbox has no real
  network/keyboard/Mail app to test against.
- **`tests/`** — the actual Playwright test suite (`npm test` runs all of it); every feature area
  should have real coverage here, not just a manual "looks right" check.

`app.js`/`index.html`/`styles.css` (plus `aesthetics/`) are the actual source of truth for current
behavior — these docs describe them, they don't override them. If something here goes stale
relative to the real files, trust the files and fix the doc (this file included).
