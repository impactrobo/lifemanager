# LIFEMaster.EXE — Project Overview

## What this is

**LIFEMaster.EXE** (internal title: *"LIFEMaster.EXE — P-Zero Tracker"*) is a single-file,
offline-first personal life-tracking web app. It runs entirely client-side — one `.html` file
containing all markup, CSS, and JavaScript, with `localStorage` as its only persistence layer.
There is no backend, no build step, and no external runtime dependencies beyond Google Fonts
(for aesthetic theming) and Chart.js (for progress charts).

It's built for one person's actual daily use — not a generic multi-user product — and covers
six life domains from one bottom-tab-navigated mobile-first interface:

1. **Exercise** — structured strength + cardio training programs, workout logging, progress charts
2. **Schedule** — a fixed daily routine ("anchors"), periodic check-ins, a schedule builder, and a calendar
3. **Hobbies** — currently guitar practice tracking (chords/songs/technique/practice log)
4. **Health & Diet** — body weight, calorie logging, measurements, TDEE/macro calculators, meal
   planning, longevity habits (skin cycling, supplements), and a shopping list
5. **Notes** — a tagged, rich-text journal with photo attachments
6. **Budget** — monthly income, recurring bills/subscriptions (with a savings/investment flag),
   and one-off incidental spending, visualized as a single reserved-vs-spent bar

The whole app is reskinnable via ten selectable visual "aesthetics" (see Architecture doc) —
this was explicitly designed as a fun, personal touch, not just a light/dark toggle.

## Who it's for / how it's used

Built and actively used by one person (Nakk) as their daily driver for training, habits,
budgeting, and journaling. Development happens conversationally with Claude: the person
describes a feature or a tweak in plain language, and each session implements it directly in
the HTML file, tests it with Playwright, and republishes it as a Claude Artifact (a hosted,
shareable web page) that the person opens on their phone/desktop like any other web app.

There is no ticket tracker or issue backlog outside of conversation — `ROADMAP.md` in this
project is the closest thing to one, and it should be kept current as ideas come up and get
built (or explicitly deferred).

## Design philosophy (things worth preserving in future changes)

- **One file, no build step.** Everything ships inline. This is a deliberate constraint — it's
  what makes "edit → test → publish as an Artifact" possible in a single Claude session with no
  deploy pipeline. Don't introduce bundlers, npm dependencies shipped to the client, or a
  multi-file source layout for the shipped app itself.
- **Local-first, no account.** All data lives in `localStorage` on the device. The only backup
  path is a manual JSON export/import (Setup → Data). Any future sync feature needs to keep this
  export/import path working as the fallback.
- **Config-style editing, not modal forms.** Most editable lists (recurring charges, categories,
  schedule anchors) render as always-visible, inline-editable rows rather than "open a dialog to
  edit" — consistent with the rest of the UI. Keep new editable lists in this style.
- **Personality over neutrality.** The aesthetic system, custom SVG icon set, and playful copy
  (tab labels, empty states) are core to the experience, not decoration bolted on afterward. A
  new feature should get its own icon and read naturally within at least the default aesthetic
  before considering how it looks in the other nine.
- **Mobile-first, thumb-reachable.** Primary nav is a bottom tab bar; screens assume a narrow
  viewport first. Anything added to the bottom bar must account for it becoming horizontally
  scrollable once a section has more sub-tabs than fit (see Architecture doc — this was a real
  bug, not a hypothetical).

## How this Claude Project is organized

This project's knowledge should contain:

- **`PROJECT_OVERVIEW.md`** (this file) — what the app is and why it's built this way
- **`ARCHITECTURE.md`** — how the code is actually structured: rendering model, the CSS
  design-token/aesthetic system, the SVG icon system, testing conventions, and the
  publish-as-Artifact workflow
- **`DATA_MODEL.md`** — the full shape of `STATE` (the one object that is the entire app's data)
- **`ROADMAP.md`** — planned features, ideas raised but not yet built, and known gaps/limitations
- **`ironlog.html`** — the actual current source of the app, uploaded as-is

When starting a new session in this project to make a change: skim `ARCHITECTURE.md` for the
relevant subsystem (aesthetics, icons, a given feature's render functions) before editing, check
`DATA_MODEL.md` before adding or changing any stored field, and update `ROADMAP.md` when a
planned item gets built or a new idea comes up worth remembering. Treat `ironlog.html` as the
one source of truth for current behavior — these docs describe it, they don't override it, so
if something here goes stale relative to the actual file, trust the file and fix the doc.
