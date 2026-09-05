# LIFEMaster.EXE — Roadmap & Open Ideas

This is a living document — the closest thing this project has to an issue tracker. **Update it
whenever a session ships a real feature (move it to Recently Shipped) or a new idea comes up
worth remembering (add it under Ideas Worth Considering).** Nothing in here should be treated as
committed work until the person actually asks for it — this is a memory aid, not a promise.

## Known limitations (by design, worth knowing before "fixing" them)

- **No cloud sync / no account.** Data lives only in the browser's `localStorage` on one device.
  Switching devices or browsers means a manual JSON export on the old one and import on the new
  one (Setup → Data). This is an intentional local-first tradeoff, not an oversight — any sync
  feature would need to keep the export/import path working as a fallback regardless.
  Enabling one of the Artifact runtime capabilities that gives an artifact per-user database
  storage could be one path here in the future, but has not been decided or asked for.
- **Single-user.** There's no concept of multiple people or profiles — one `STATE` object per
  browser.
- **No push notifications / reminders.** The Reminders feature (Schedule) is a list you look at,
  not something that alerts you — there's no service worker or notification permission flow.
- **Rest timer can be throttled.** It runs on a plain `setInterval`; like any tab-based timer,
  mobile OSes can throttle it once the screen locks or the tab backgrounds. A service worker
  would be the real fix; not attempted so far.
- **Sandbox font/CDN verification.** Not a product limitation, but worth remembering for
  development sessions: this dev environment's network egress blocks Google Fonts/CDN requests,
  so custom fonts can never be visually screenshot-verified here — only their CSS declarations
  can be checked. See `ARCHITECTURE.md` → Testing.

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
  IRA — $250/mo toward a $7,000/yr cap") to show progress, not just the flat monthly figure.
- **Notes:** full-text search across notes (currently browse/filter by tag only, via VIEW ALL).
- **Schedule:** a way to see the week at a glance across multiple named schedules, not just one
  active schedule's daily anchors + a plain calendar.
- **General:** the twelve-aesthetic system is designed to be extended further (see
  `ARCHITECTURE.md`'s checklist); nothing specific has been requested, but the system clearly
  invites more.

## Recently shipped (changelog)

Newest first. Keep this reasonably current so a fresh session can see what already exists
without re-reading the whole diff history.

- **Thrash Metal & Four Symbols aesthetics added; Spooky Scary redesigned as Jack-o'-Lantern** —
  three new/reworked looks built from an iteratively-refined concept dossier and merged into the
  real aesthetic system:
  - *Thrash Metal* — amp-stack black with yellow/blood-red/chrome accents, Metal Mania display
    font, a hard-edged `--bad` drop-shadow behind every headline instead of a glow, cut-corner
    panels via `clip-path`, and a faceted grey-outlined lightning-bolt SVG body pattern.
  - *Four Symbols (Sì Xiàng)* — a guardian picker (Azure Dragon / Vermilion Phoenix / White Tiger
    / Black Tortoise) that fully re-themes background, borders and text, generalizing Retro
    Terminal's "full mini-palette" MAIN COLOR mechanic (`FULL_PALETTE_AESTHETICS`) to a second
    aesthetic; guardian choice persists via the existing `settings.accentByAesthetic` field, no
    new `STATE` field needed. Ma Shan Zheng + ZCOOL XiaoWei fonts; a single-outline woodblock-
    style cloud tile masked over `--accent-soft` on a `body::before` layer so it retints per
    guardian.
  - *Jack-o'-Lantern* (replaces Spooky Scary in place, same `spookyscary` key/save-compatibility)
    — carved-pumpkin palette (amber/violet/witch-green), Creepster + IM Fell English fonts, a
    warm multi-layer `--accent` glow plus a neon `--good`-green `-webkit-text-stroke` outline on
    headlines (replacing the old vignette-overlay signature), and a tiled jack-o'-lantern
    silhouette SVG body pattern with glowing eyes/mouth.
- **Budget savings/investment flag** — recurring charges can be flagged as savings/investment
  (vs. plain spending), shown with a distinct `--savings` color badge and their own segment on
  the budget bar, separate from regular reserved expenses.
- **Notes: 3rd default tag relabeled** — "Win" → "Experience" (same underlying `win` key, so
  existing notes tagged with it are unaffected).
- **New SVG icon set for several bottom-nav tabs** — lock (empty/locked training states), plus
  TODAY, WEIGHT, MEASURE, DIET, LONGEVITY, SHOPPING, WRITE, VIEW ALL, RECURRING, OVERVIEW — see
  `ARCHITECTURE.md` for the full icon convention.
- **Bottom tabbar horizontal-scroll fix** — sections with more sub-tabs than fit (Health & Diet's
  five) used to silently overflow the viewport with no way to reach the last tab(s); the tabbar
  is now horizontally scrollable with a fading scroll indicator, matching the page's own.
- **Gutterslime aesthetic** — matte dark-green industrial shell, glowing toxic-neon accents, a
  generated SVG diamond-plate tread-pattern body background, Wallpoet display font.
- **Neo-Brutalist: darker/cooler background** — background shifted from a cream/yellow tone to a
  darker grey-blue, leaving the yellow accent and black borders untouched.
- **Retro Terminal's accent picker → full "MAIN COLOR" palette-shift** — instead of a single
  accent swatch, Terminal now ships several complete phosphor-color mini-palettes.
- **Cyberpunk Neon made the default aesthetic**; Simple and Windows 95 aesthetics removed.
- **Sakura contrast fix** — white-on-pink text legibility issue on `.btn-primary`.
- **Honey & Bee deepened/3D-ified** — richer palette plus an embossed tessellating-hexagon SVG
  body background, with legibility fixes (text halos) for bare text sitting on the pattern.
- **TODAY schedule layout** — more vertical buffer per row, checkmark moved to consistently be
  the trailing (right) element of each row.
