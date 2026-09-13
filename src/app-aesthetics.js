// app-aesthetics.js -- Icon set, the aesthetic/accent registries, and the lazy FX-module loader.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ================= ICONS =================
// Small duotone SVG icon set — soft accent-orange fill + solid accent-orange line/detail work,
// sized via width/height="1em" so they scale with whatever font-size their container sets
// (matches how the emoji glyphs they replace used to size themselves). "close" is the one
// exception: it inherits currentColor rather than a fixed accent, because the delete buttons
// that use it lean on the surrounding button's own color (neutral grey by default, red for the
// one destructive "remove exercise" action) — hardcoding it orange would erase that danger cue.
const ICONS = {
  home: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" fill="var(--accent)" fill-opacity=".16"/><path d="M3 11 12 4l9 7M6 10v9.5h12V10" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="10" y="14" width="4" height="6" rx="0.6" fill="var(--accent)"/></svg>`,
  schedule: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="1.6" fill="var(--accent)" fill-opacity=".16" stroke="var(--accent)" stroke-width="1.6"/><path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/><rect x="8" y="12" width="3" height="3" rx="0.5" fill="var(--accent)"/></svg>`,
  exercise: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="2.3" y="10" width="3" height="4" rx="0.8" fill="var(--accent)" fill-opacity=".35"/><rect x="18.7" y="10" width="3" height="4" rx="0.8" fill="var(--accent)" fill-opacity=".35"/><rect x="5" y="8.5" width="2" height="7" rx="0.6" fill="var(--accent)"/><rect x="17" y="8.5" width="2" height="7" rx="0.6" fill="var(--accent)"/><path d="M7 12h10" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  hobbies: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="12.1" y="2.7" width="2.1" height="10.5" rx="1" transform="rotate(35 13.15 8)" fill="var(--accent)"/><circle cx="8.6" cy="15.6" r="3.7" fill="var(--accent)" fill-opacity=".18" stroke="var(--accent)" stroke-width="1.5"/><circle cx="12.4" cy="11.9" r="2.6" fill="var(--accent)" fill-opacity=".18" stroke="var(--accent)" stroke-width="1.5"/><circle cx="8.6" cy="15.6" r="1" fill="var(--accent)"/></svg>`,
  health: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M12 20s-7.5-4.7-9.8-9.4C.7 6.9 3 3.6 6.4 3.6c2 0 3.5 1 5.6 3.1 2.1-2.1 3.6-3.1 5.6-3.1 3.4 0 5.7 3.3 4.2 7-2.3 4.7-9.8 9.4-9.8 9.4z" fill="var(--accent)" fill-opacity=".18" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  comingSoon: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="var(--accent)" fill-opacity=".14" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="2.5 2.5"/><path d="M12 8v8M8 12h8" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  setup: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><g fill="var(--accent)" fill-opacity=".18" stroke="var(--accent)" stroke-width="1.3" stroke-linejoin="round"><circle cx="12" cy="12" r="6.4"/><rect x="10.5" y="1.7" width="3" height="3.6" rx="0.7"/><rect x="10.5" y="1.7" width="3" height="3.6" rx="0.7" transform="rotate(45 12 12)"/><rect x="10.5" y="1.7" width="3" height="3.6" rx="0.7" transform="rotate(90 12 12)"/><rect x="10.5" y="1.7" width="3" height="3.6" rx="0.7" transform="rotate(135 12 12)"/><rect x="10.5" y="1.7" width="3" height="3.6" rx="0.7" transform="rotate(180 12 12)"/><rect x="10.5" y="1.7" width="3" height="3.6" rx="0.7" transform="rotate(225 12 12)"/><rect x="10.5" y="1.7" width="3" height="3.6" rx="0.7" transform="rotate(270 12 12)"/><rect x="10.5" y="1.7" width="3" height="3.6" rx="0.7" transform="rotate(315 12 12)"/></g><circle cx="12" cy="12" r="2.3" fill="var(--accent)"/></svg>`,
  progress: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M4 19V9M9 19v-5M14 19V6M19 19v-9" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-opacity=".28"/><path d="M4 14l5-4 4 3 7-9" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 4h5v5" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg class="icon-svg" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--accent)" fill-opacity=".16"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  close: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  up: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  down: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  back: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  forward: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  notes: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="1.6" fill="var(--accent)" fill-opacity=".16" stroke="var(--accent)" stroke-width="1.6"/><path d="M8 8.5h8M8 12h8M8 15.5h5" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  budget: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="2.5" y="6" width="19" height="13" rx="2.2" fill="var(--accent)" fill-opacity=".16" stroke="var(--accent)" stroke-width="1.6"/><circle cx="12" cy="12.5" r="3.4" fill="var(--accent)" fill-opacity=".18" stroke="var(--accent)" stroke-width="1.4"/><path d="M12 10.4v4.2M13.3 11.4c-.3-.5-.9-.7-1.4-.7-.8 0-1.4.5-1.4 1.1 0 1.4 2.8.6 2.8 2 0 .6-.6 1.1-1.4 1.1-.6 0-1.1-.2-1.5-.7" fill="none" stroke="var(--accent)" stroke-width="1.1" stroke-linecap="round"/></svg>`,
  timer: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="var(--accent)" fill-opacity=".16" stroke="var(--accent)" stroke-width="1.6"/><path d="M12 9v4l3 2" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 2.5h5M12 4.5V2.5" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  pause: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="7" y="5" width="4" height="14" rx="1" fill="var(--accent)"/><rect x="13" y="5" width="4" height="14" rx="1" fill="var(--accent)"/></svg>`,
  play: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="var(--accent)"/></svg>`,
  chevronRight: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  repeat: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M4 11a8 8 0 0 1 13.9-5.4M20 13a8 8 0 0 1-13.9 5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M17.5 3v3.2h-3.2M6.5 21v-3.2h3.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  clipboard: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="5" y="4.5" width="14" height="17" rx="1.8" fill="var(--accent)" fill-opacity=".12" stroke="var(--accent)" stroke-width="1.6"/><rect x="9" y="3" width="6" height="3.4" rx="1" fill="var(--accent)" stroke="var(--accent)" stroke-width="1.2"/><path d="M8.3 12h7.4M8.3 15.3h7.4M8.3 8.7h4" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  lock: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="1.8" fill="var(--accent)" fill-opacity=".16" stroke="var(--accent)" stroke-width="1.6"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="15" r="1.6" fill="var(--accent)"/><path d="M12 16.6v2" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  // Generic maritime anchor glyph — not tied to any aesthetic, stroke="currentColor" so a caller
  // sets its color inline (used per-schedule-color on Calendar cells, see scheduleColorFor()).
  anchorMark: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><circle cx="12" cy="4.5" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 6.5V19M8.5 10h7M5 14a7 7 0 0 0 7 7 7 7 0 0 0 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 14l1.8-1.3M19 14l-1.8-1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  scale: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M12 4v15M7.5 19h9" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/><path d="M4.5 6.5h15" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="4" r="1.3" fill="var(--accent)"/><path d="M4.5 6.5 2 11.5a2.7 2.7 0 0 0 5 0z" fill="var(--accent)" fill-opacity=".22" stroke="var(--accent)" stroke-width="1.3" stroke-linejoin="round"/><path d="M19.5 6.5 17 11.5a2.7 2.7 0 0 0 5 0z" fill="var(--accent)" fill-opacity=".22" stroke="var(--accent)" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  drumstick: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M9 9.5c-2.6 2.6-3.8 6.7-1.6 8.9s6.3 1 8.9-1.6c2.1-2.1 2.6-4.9 1.1-6.4-.8-.8-1.9-.9-2.9-.6.4-1.2.2-2.5-.7-3.4-1.5-1.5-4-1-6.1 1.1-.6.6-1 1.3-1.3 2z" fill="var(--accent)" fill-opacity=".22" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.3 15.7 3.5 20.5" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/><circle cx="4.6" cy="19.4" r="1.3" fill="var(--accent)"/></svg>`,
  ruler: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><g transform="rotate(45 12 12)"><rect x="3" y="9.5" width="18" height="5" rx="1" fill="var(--accent)" fill-opacity=".16" stroke="var(--accent)" stroke-width="1.4"/><path d="M6 9.5v2.2M9.5 9.5v2.2M13 9.5v2.2M16.5 9.5v2.2" stroke="var(--accent)" stroke-width="1.2" stroke-linecap="round"/></g></svg>`,
  infinity: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M9.5 8c1.556 0 2.99.8 4.5 2c1.51-1.2 2.944-2 4.5-2a4 4 0 1 1 0 8c-1.556 0-2.99-.8-4.5-2c-1.51 1.2-2.944 2-4.5 2a4 4 0 0 1 0-8z" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  bag: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M6 8h12l1 12.5a1.4 1.4 0 0 1-1.4 1.5H6.4A1.4 1.4 0 0 1 5 20.5z" fill="var(--accent)" fill-opacity=".16" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8V6a3 3 0 0 1 6 0v2" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/><path d="M6.5 11h11" stroke="var(--accent)" stroke-width="1.3" stroke-opacity=".6"/></svg>`,
  pencil: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M16.5 3.5 20 7 8.5 18.5 4 20l1.5-4.5z" fill="var(--accent)" fill-opacity=".18" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/><path d="M14.5 5.5 18 9" stroke="var(--accent)" stroke-width="1.4"/><path d="M4 20l1.5-4.5 3 3z" fill="var(--accent)"/></svg>`,
  magnify: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="var(--accent)" fill-opacity=".14" stroke="var(--accent)" stroke-width="1.7"/><path d="M15 15l5.5 5.5" stroke="var(--accent)" stroke-width="1.9" stroke-linecap="round"/></svg>`,
  recurDollar: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M4 11a8 8 0 0 1 13.9-5.4M20 13a8 8 0 0 1-13.9 5.4" fill="none" stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round"/><path d="M17.5 3v3.2h-3.2M6.5 21v-3.2h3.2" fill="none" stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="14.6" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--accent)">$</text></svg>`,
  mountain: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M2.5 19 9 7l3.4 5.8L15 9.5 21.5 19z" fill="var(--accent)" fill-opacity=".18" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7l1.7 2.9-1.7 1-1.9-1.1z" fill="var(--accent)"/></svg>`,
  flag: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M6 21V4" stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round"/><path d="M6 4.5c2-1.6 4-1.6 6 0s4 1.6 6 0v8c-2 1.6-4 1.6-6 0s-4-1.6-6 0z" fill="var(--accent)" fill-opacity=".2" stroke="var(--accent)" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  bell: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M12 3.5c-2.2 0-4 1.8-4 4v3.2c0 .8-.3 1.6-.9 2.2L5.8 14.3c-.6.6-.2 1.7.7 1.7h11c.9 0 1.3-1.1.7-1.7l-1.3-1.4c-.6-.6-.9-1.4-.9-2.2V7.5c0-2.2-1.8-4-4-4z" fill="var(--accent)" fill-opacity=".18" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  wallet: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13.5" rx="2" fill="var(--accent)" fill-opacity=".16" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round"/><path d="M13 9.5h5.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H13z" fill="var(--accent)" fill-opacity=".26" stroke="var(--accent)" stroke-width="1.3" stroke-linejoin="round"/><circle cx="17.3" cy="13" r="1.1" fill="var(--accent)"/></svg>`,
  mobility: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><circle cx="12" cy="4.2" r="2" fill="var(--accent)"/><path d="M12 6.5v6M12 8.5 6 6M12 8.5l6.5-1.5M12 12.5 7 19M12 12.5l4.5 4" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  warmup: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M12 2.5c1 3-2.5 4-2.5 7a2.5 2.5 0 0 0 5 0c0-1-.5-1.7-1-2.3 1.8.6 3.5 2.7 3.5 5.3a5 5 0 0 1-10 0c0-4 3-5.5 3-8 0-.7 1-1.5 2-2z" fill="var(--accent)" fill-opacity=".22" stroke="var(--accent)" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  planner: `<svg class="icon-svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="1.6" fill="var(--accent)" fill-opacity=".16" stroke="var(--accent)" stroke-width="1.6"/><path d="M4 9.5h16M8 3.5v3M16 3.5v3" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/><path d="M8.5 14.5l2.2 2.2 4.3-4.7" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};
ICONS.settings = ICONS.setup; // app-appearance settings reuses the same gear glyph as the Setup tab
function icon(name) { return ICONS[name] || ''; }
// Reads an input's value/checked by id, tolerating the element not being in the current render.
// The typecheck can't catch a wrong or not-yet-rendered id here — types/app.d.ts widens
// HTMLElement with `value: any` (its own comment calls this a known blind spot) — so a bare
// `.value` on null compiles clean and throws mid-save, which is exactly how saveReminder() once
// crashed when #remEndTime didn't exist yet. Every literal-id read goes through these; a test
// (test_input_helpers.js) fails the suite if a bare one creeps back in.
function inputVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function inputChecked(id) { const el = document.getElementById(id); return !!(el && el.checked); }

// Per-aesthetic accent palettes for the Settings picker. Every aesthetic ignores the device's
// light/dark setting and ships one fixed backdrop, so its palette entries carry a single `value`
// instead of a dark/light pair — colors curated to read well against that one backdrop.
// Retro Terminal is the exception: its "MAIN COLOR" choice re-themes the whole terminal look
// (background, borders, every shade of text), not just one accent variable, so each of its entries
// is a full mini-palette instead of a single `value` — see TERMINAL_PALETTE_VARS / applyAccentColor().
const AESTHETIC_ACCENTS = {
  terminal: {
    green: { label: 'Phosphor Green', accent: '#39ff6a', bg: '#060a06', surface: '#0d140d', surface2: '#121b12', border: '#234226', borderSoft: '#17281a', text: '#4dff7a', textDim: '#2fae55', textFaint: '#1f6b38', good: '#39ff6a', goodSoft: '#0f2415', resetBorder: '#4dff7a', resetBg: '#16261a', resetText: '#4dff7a' },
    amber: { label: 'Amber',          accent: '#ffb000', bg: '#0a0704', surface: '#161009', surface2: '#1e160b', border: '#4a3814', borderSoft: '#2a2009', text: '#ffc266', textDim: '#c98a1e', textFaint: '#7a5312', good: '#ffb000', goodSoft: '#241a08', resetBorder: '#ffc266', resetBg: '#261c0c', resetText: '#ffc266' },
    cyan:  { label: 'Cyan',           accent: '#00e5ff', bg: '#040a0a', surface: '#0a1616', surface2: '#0e1e1e', border: '#1c4a4a', borderSoft: '#122a2a', text: '#4dffff', textDim: '#2fb0b0', textFaint: '#1f6b6b', good: '#00e5ff', goodSoft: '#0a2424', resetBorder: '#4dffff', resetBg: '#16262a', resetText: '#4dffff' },
    red:   { label: 'Red Alert',      accent: '#ff3b3b', bg: '#0a0505', surface: '#160a0a', surface2: '#1e0e0e', border: '#4a1c1c', borderSoft: '#2a1212', text: '#ff8a8a', textDim: '#c94040', textFaint: '#7a2626', good: '#ff5b5b', goodSoft: '#240a0a', resetBorder: '#ff8a8a', resetBg: '#261212', resetText: '#ff8a8a' },
    white: { label: 'White Paper',    accent: '#eaeaea', bg: '#07080a', surface: '#121316', surface2: '#181a1e', border: '#3d4247', borderSoft: '#22262a', text: '#eaeaea', textDim: '#a8adb2', textFaint: '#6b7176', good: '#eaeaea', goodSoft: '#1c2024', resetBorder: '#eaeaea', resetBg: '#22262a', resetText: '#eaeaea' },
  },
  // Four Symbols (Sì Xiàng): each guardian is a full mini-palette, same shape as Retro Terminal's
  // MAIN COLOR entries above — see FULL_PALETTE_AESTHETICS / applyAccentColor(). --bad, --warn,
  // --myo, --goldenrod, --savings, fonts and radius stay fixed across all four guardians in the
  // base :root[data-aesthetic="sixiang"] block below; only the properties listed here swap.
  sixiang: {
    dragon:   { label: 'Azure Dragon',      accent: '#22d3ee', bg: '#050f14', surface: '#0a1d24', surface2: '#0f2830', border: '#1c4d55', borderSoft: '#123138', text: '#d8f5f0', textDim: '#7fb8c0', textFaint: '#4a7d85', good: '#4ade80', goodSoft: '#0f2a1c', resetBorder: '#22d3ee', resetBg: '#123138', resetText: '#22d3ee' },
    phoenix:  { label: 'Vermilion Phoenix', accent: '#ff3b30', bg: '#170505', surface: '#2b0a0a', surface2: '#3a0f0f', border: '#7a1f1f', borderSoft: '#4d1414', text: '#ffe8d6', textDim: '#e0a978', textFaint: '#a06848', good: '#ffb703', goodSoft: '#3a2408', resetBorder: '#ff3b30', resetBg: '#4d1414', resetText: '#ff3b30' },
    tiger:    { label: 'White Tiger',       accent: '#b8ccdb', bg: '#0e1013', surface: '#191c20', surface2: '#22262b', border: '#4a5058', borderSoft: '#2e3339', text: '#f5f5f5', textDim: '#c2c5c9', textFaint: '#7d8288', good: '#7de2d1', goodSoft: '#122421', resetBorder: '#b8ccdb', resetBg: '#2e3339', resetText: '#b8ccdb' },
    tortoise: { label: 'Black Tortoise',    accent: '#14b8a6', bg: '#05080a', surface: '#0c1417', surface2: '#121c20', border: '#1f3a3f', borderSoft: '#142428', text: '#d6f0ec', textDim: '#7fb0a8', textFaint: '#4a7570', good: '#34d399', goodSoft: '#0e2620', resetBorder: '#14b8a6', resetBg: '#142428', resetText: '#14b8a6' },
  },
  thrash: {
    yellow: { label: 'Thrash Yellow', value: '#ffd400' },
    red:    { label: 'Blood Red',     value: '#ff1f3d' },
    silver: { label: 'Chrome Silver', value: '#c0c0c0' },
    orange: { label: 'Amp Orange',    value: '#ff6a00' },
    blue:   { label: 'Riot Blue',     value: '#29b6ff' },
  },
  editorial: {
    gold:     { label: 'Gold',     value: '#b8863a' },
    burgundy: { label: 'Burgundy', value: '#7a2331' },
    forest:   { label: 'Forest',   value: '#2f4a3a' },
    navy:     { label: 'Navy',     value: '#26344d' },
    blush:    { label: 'Blush',    value: '#b5675a' },
  },
  brutalist: {
    yellow: { label: 'Safety Yellow', value: '#e0d000' },
    red:    { label: 'Blood Red',     value: '#d61f1f' },
    blue:   { label: 'Cobalt',        value: '#0044dd' },
    green:  { label: 'Toxic Green',   value: '#2fae1a' },
    pink:   { label: 'Hot Pink',      value: '#e6178a' },
    black:  { label: 'Ink',           value: '#0a0a0a' },
  },
  soft: {
    sage:     { label: 'Sage',       value: '#8fa888' },
    rose:     { label: 'Dusty Rose', value: '#c98a93' },
    powder:   { label: 'Powder Blue',value: '#7fa2b8' },
    lavender: { label: 'Lavender',   value: '#a08fc4' },
    sand:     { label: 'Sand',       value: '#c2a06f' },
  },
  cyberpunk: {
    magenta: { label: 'Neon Magenta',    value: '#ff2bd6' },
    cyan:    { label: 'Neon Cyan',       value: '#00e5ff' },
    purple:  { label: 'Electric Purple', value: '#9d4bff' },
    acid:    { label: 'Acid Green',      value: '#c6ff00' },
    orange:  { label: 'Neon Orange',     value: '#ff6b1a' },
  },
  academia: {
    sepia:    { label: 'Sepia',   value: '#8a5a28' },
    forest:   { label: 'Forest',  value: '#33472e' },
    brass:    { label: 'Brass',   value: '#a8813c' },
    navy:     { label: 'Navy',    value: '#22304a' },
    umber:    { label: 'Umber',   value: '#5a3e2b' },
  },
  sakura: {
    blossom: { label: 'Blossom Pink', value: '#e8749a' },
    plum:    { label: 'Plum',         value: '#b06a8a' },
    peach:   { label: 'Peach',        value: '#e8a67a' },
    lilac:   { label: 'Lilac',        value: '#b89bd9' },
    mint:    { label: 'Mint',         value: '#8fc9a8' },
  },
  honey: {
    amber:   { label: 'Amber',   value: '#d9800a' },
    gold:    { label: 'Gold',    value: '#c9940a' },
    caramel: { label: 'Caramel', value: '#8f5214' },
    mustard: { label: 'Mustard', value: '#a8841a' },
    clover:  { label: 'Clover',  value: '#63752a' },
  },
  gutterslime: {
    slime:       { label: 'Slime Green',       value: '#c6ff1a' },
    toxic:       { label: 'Toxic Yellow',      value: '#e8ff3d' },
    radioactive: { label: 'Radioactive',       value: '#9fff5c' },
    acid:        { label: 'Acid Chartreuse',   value: '#d4ff00' },
    sludge:      { label: 'Sludge Lime',       value: '#b8d936' },
  },
  // C.R.E.A.M is a MAIN COLOR aesthetic, not an accent one: each entry is a full mini-palette
  // (see FULL_PALETTE_AESTHETICS). Gold stays the accent in both — what swaps is the suit, and
  // with it `--good`, which is what the primary/confirm buttons are built from. So picking
  // Dollar Green turns the suit green and flips those buttons to purple, and vice versa.
  // `swatch` overrides the picker chip, which would otherwise show the identical gold accent
  // for both options.
  cream: {
    purple: {
      label: 'Regal Purple', swatch: '#7a3fc0', accent: '#e0a512',
      bg: '#2a0d44', surface: '#3a1560', surface2: '#481c74',
      border: '#9c7c2a', borderSoft: '#5d3a86',
      text: '#f6efe0', textDim: '#c9b48f', textFaint: '#9c8a6d',
      good: '#1fbf6b', goodSoft: '#0f3626',
      resetBorder: '#f6efe0', resetBg: '#481c74', resetText: '#f6efe0',
    },
    green: {
      label: 'Dollar Green', swatch: '#1f9c5c', accent: '#e0a512',
      bg: '#0b2a1b', surface: '#123f2b', surface2: '#175236',
      border: '#9c7c2a', borderSoft: '#245e42',
      text: '#f6efe0', textDim: '#c9b48f', textFaint: '#8fa389',
      good: '#8b5cf6', goodSoft: '#251043',
      resetBorder: '#f6efe0', resetBg: '#175236', resetText: '#f6efe0',
    },
  },
  draconic: {
    ember:   { label: 'Ember',      value: '#ffb020' },
    molten:  { label: 'Molten Gold',value: '#ffd24a' },
    scorch:  { label: 'Scorch',     value: '#ff6b1a' },
    blood:   { label: 'Wyrm Blood', value: '#e02617' },
    brass:   { label: 'Old Brass',  value: '#c98a2b' },
  },
  y2k: {
    cyan:    { label: 'Ice Cyan',   value: '#4de3ff' },
    magenta: { label: 'Oil Slick',  value: '#ff4dd8' },
    violet:  { label: 'Ultraviolet',value: '#9b5cff' },
    lime:    { label: 'Toxic Lime', value: '#b8ff3d' },
    silver:  { label: 'Pure Chrome',value: '#c9d4e0' },
  },
  // Millennium Disco is a MAIN COLOR aesthetic (see FULL_PALETTE_AESTHETICS): each entry is a
  // whole lit room, not a tint. Two tokens do double duty in theme.css — `accent` and `good` are
  // the two ends of the stepped border ramp, and the middle step is color-mix()'d between them,
  // so picking a vibe restyles every frame in the app. That does mean `--good` (the done/confirm
  // colour) is the second disco hue rather than a green; same trade C.R.E.A.M makes.
  millennium: {
    warm: {
      label: 'Warm Vibe', accent: '#ff7a18',
      bg: '#1a0511', surface: '#2e0a1e', surface2: '#3d1029',
      border: '#8a2a52', borderSoft: '#4f1533',
      text: '#fff0f6', textDim: '#e6a9c4', textFaint: '#ab7291',
      good: '#ff2d95', goodSoft: '#420a26',
      resetBorder: '#fff0f6', resetBg: '#3d1029', resetText: '#fff0f6',
    },
    cool: {
      label: 'Cool Vibe', accent: '#2f9dff',
      bg: '#04101f', surface: '#0a2039', surface2: '#0f2c4e',
      border: '#2e639b', borderSoft: '#173c64',
      text: '#eaf6ff', textDim: '#a9caea', textFaint: '#6e93b8',
      good: '#9fe8ff', goodSoft: '#0a3243',
      resetBorder: '#eaf6ff', resetBg: '#0f2c4e', resetText: '#eaf6ff',
    },
    acid: {
      label: 'Acid Vibe', accent: '#b6ff1a',
      bg: '#0a1204', surface: '#17260b', surface2: '#203312',
      border: '#527f1e', borderSoft: '#2d4d13',
      text: '#f3ffe2', textDim: '#c1dc9e', textFaint: '#849f66',
      good: '#ffe23d', goodSoft: '#2c3a09',
      resetBorder: '#f3ffe2', resetBg: '#203312', resetText: '#f3ffe2',
    },
    ultraviolet: {
      label: 'Ultraviolet', accent: '#a855f7',
      bg: '#0d0420', surface: '#1c0c3a', surface2: '#281351',
      border: '#6033a3', borderSoft: '#381c6b',
      text: '#f4ecff', textDim: '#c3abea', textFaint: '#8d75b7',
      good: '#22e0e0', goodSoft: '#0b3742',
      resetBorder: '#f4ecff', resetBg: '#281351', resetText: '#f4ecff',
    },
  },
  // Liminal's accent is the colour of the tube behind the diffuser — it tints the trim, the
  // panel glow and the primary controls, and deliberately leaves the yellow walls alone.
  liminal: {
    sodium: { label: 'Sodium',      value: '#d98b21' },
    dead:   { label: 'Dead Green',  value: '#8a9a33' },
    exit:   { label: 'Exit Sign',   value: '#c0392b' },
    cool:   { label: 'Cool White',  value: '#7fa6b5' },
    black:  { label: 'Blacklight',  value: '#7c5cc4' },
  },
  runic: {
    rune:   { label: 'Rune Green',  value: '#4fe08c' },
    ember:  { label: 'Forge Ember', value: '#ff8c3a' },
    frost:  { label: 'Frostbite',   value: '#6fd8ff' },
    blood:  { label: 'Blood Oath',  value: '#e0483f' },
    silver: { label: 'Moon Silver', value: '#c8d2d8' },
  },
  metalheart: {
    cerulean: { label: 'Cerulean',    value: '#1fa8e0' },
    viridian: { label: 'Viridian',    value: '#18d6a8' },
    acid:     { label: 'Acid Green',  value: '#86e01a' },
    xenon:    { label: 'Xenon',       value: '#4fd6e8' },
    gunmetal: { label: 'Gunmetal',    value: '#9fb4c0' },
  },
  frutigeraero: {
    aqua:    { label: 'Aqua',      value: '#00a8e8' },
    sky:     { label: 'Sky',       value: '#3aa0ff' },
    lagoon:  { label: 'Lagoon',    value: '#00c2b2' },
    lime:    { label: 'Lime',      value: '#7cc043' },
    sunbeam: { label: 'Sunbeam',   value: '#f7b731' },
  },
  spookyscary: {
    pumpkin: { label: 'Pumpkin Glow',  value: '#ffb627' },
    witch:   { label: 'Witch Violet',  value: '#b06aff' },
    ghoul:   { label: 'Witch Green',   value: '#8aff6a' },
    blood:   { label: 'Blood Red',     value: '#ff3b3b' },
    ghost:   { label: 'Candle Cream',  value: '#f5e6c8' },
  },
  // Space Highway is a MAIN COLOR aesthetic (see FULL_PALETTE_AESTHETICS): each entry is the
  // sector of space the ring-highway is passing through — a whole deep-space palette, not a
  // tint. `accent` is the dominant nebula hue and `good` a harmonised second light; the road,
  // Saturn's limb and the cars are baked into scene.svg and stay constant, so what a sector
  // swaps is the backdrop wash, the star and swirl colour, and every shade of UI chrome.
  spacehighway: {
    andromeda: {
      label: 'Andromeda Blue', accent: '#3fb4e6',
      bg: '#050912', surface: '#0e1626', surface2: '#141f33',
      border: '#2c4059', borderSoft: '#1b2a3f',
      text: '#e6f1fb', textDim: '#93accb', textFaint: '#586d89',
      good: '#48d0a4', goodSoft: '#0c2a22',
      resetBorder: '#e6f1fb', resetBg: '#141f33', resetText: '#e6f1fb',
    },
    violet: {
      label: 'Violet Nebula', accent: '#a875f0',
      bg: '#0a0518', surface: '#180f2e', surface2: '#1f153b',
      border: '#402f66', borderSoft: '#281b45',
      text: '#f0eafc', textDim: '#b6a6d6', textFaint: '#7a6aa0',
      good: '#46cfc6', goodSoft: '#0c2a29',
      resetBorder: '#f0eafc', resetBg: '#1f153b', resetText: '#f0eafc',
    },
    rose: {
      label: 'Rose Quartz', accent: '#ff6f9c',
      bg: '#12040d', surface: '#260b1b', surface2: '#331025',
      border: '#63304a', borderSoft: '#3d1c30',
      text: '#fdeaf1', textDim: '#dca9c1', textFaint: '#9c6e84',
      good: '#f2b34c', goodSoft: '#33280c',
      resetBorder: '#fdeaf1', resetBg: '#331025', resetText: '#fdeaf1',
    },
    aurora: {
      label: 'Aurora', accent: '#3fd992',
      bg: '#03100c', surface: '#0b2019', surface2: '#102a21',
      border: '#265041', borderSoft: '#163229',
      text: '#e4f7ee', textDim: '#9ac4b2', textFaint: '#5f8574',
      good: '#6fb6ff', goodSoft: '#0d2a3a',
      resetBorder: '#e4f7ee', resetBg: '#102a21', resetText: '#e4f7ee',
    },
  },
  // Hedge is a MAIN COLOR aesthetic (see FULL_PALETTE_AESTHETICS): each entry is a character,
  // and each character is the three colours they're actually drawn in. Colour 1 becomes
  // `accent` (the signature hue), colour 3 — or, where that colour is red or white and would
  // collide with --bad / --text, an eye or trim colour from the same character — becomes
  // `good`, and white is the text. The backdrop is that character's hue taken almost to black,
  // so the whole scene shifts, not just the trim. --bad stays a fixed crimson in theme.css on
  // purpose: three of these characters are red, and an error state has to stay separable from
  // the accent it's sitting next to.
  // Every entry carries an explicit `swatch`: the picker chip is a three-band diagonal of the
  // character's own three colours, not just their accent, because four of the eight are some
  // kind of red or pink and the accent alone made them indistinguishable in the grid. It's a
  // gradient rather than a colour, which styles.css's `.accent-swatch.active` ring can't use
  // (box-shadow needs a colour) — theme.css re-states that rule for this aesthetic.
  hedge: {
    sanic: {
      label: 'Sanic', accent: '#3d82ff',
      swatch: 'linear-gradient(135deg, #3d82ff 0 38%, #ffffff 38% 62%, #e0342a 62% 100%)',
      bg: '#050d22', surface: '#12244f', surface2: '#1b3269',
      border: '#2f4c85', borderSoft: '#1d3159',
      text: '#eef4ff', textDim: '#9fb6dd', textFaint: '#64789e',
      good: '#ffce3a', goodSoft: '#33290a',
      resetBorder: '#eef4ff', resetBg: '#1b3269', resetText: '#eef4ff',
    },
    tales: {
      label: 'Tales', accent: '#ffb01f',
      swatch: 'linear-gradient(135deg, #ffb01f 0 38%, #ffffff 38% 62%, #e0342a 62% 100%)',
      bg: '#150e04', surface: '#3a2810', surface2: '#4d3614',
      border: '#7a5a1c', borderSoft: '#4b360f',
      text: '#fff6e3', textDim: '#d9c294', textFaint: '#9c8659',
      good: '#4fc3f7', goodSoft: '#0b2a3a',
      resetBorder: '#fff6e3', resetBg: '#4d3614', resetText: '#fff6e3',
    },
    toughguy: {
      label: 'Tough Guy', accent: '#ef4b23',
      swatch: 'linear-gradient(135deg, #ef4b23 0 38%, #ffffff 38% 62%, #34c96a 62% 100%)',
      bg: '#150404', surface: '#3a100c', surface2: '#4d1611',
      border: '#7d2a22', borderSoft: '#4d1a15',
      text: '#ffeeea', textDim: '#d8a99f', textFaint: '#9c6f66',
      good: '#34c96a', goodSoft: '#0c2b18',
      resetBorder: '#ffeeea', resetBg: '#4d1611', resetText: '#ffeeea',
    },
    shade: {
      label: 'Shade', accent: '#ff1f45',
      swatch: 'linear-gradient(135deg, #16161a 0 38%, #ff1f45 38% 62%, #ffffff 62% 100%)',
      bg: '#060607', surface: '#17171c', surface2: '#25252c',
      border: '#3d3d45', borderSoft: '#26262c',
      text: '#f2f3f6', textDim: '#a9abb4', textFaint: '#6e7079',
      good: '#ffc53d', goodSoft: '#33280c',
      resetBorder: '#f2f3f6', resetBg: '#25252c', resetText: '#f2f3f6',
    },
    egbert: {
      label: 'Egbert', accent: '#f4b41a',
      swatch: 'linear-gradient(135deg, #c3211c 0 38%, #16161a 38% 62%, #f4b41a 62% 100%)',
      bg: '#100405', surface: '#300e10', surface2: '#411518',
      border: '#8a5a1e', borderSoft: '#5a3712',
      text: '#fdf1de', textDim: '#d3b895', textFaint: '#96805f',
      good: '#4aa3d9', goodSoft: '#0c2634',
      resetBorder: '#fdf1de', resetBg: '#411518', resetText: '#fdf1de',
    },
    rogue: {
      label: 'Rogue', accent: '#ff5fa2',
      swatch: 'linear-gradient(135deg, #ffffff 0 38%, #ff5fa2 38% 62%, #4a2472 62% 100%)',
      bg: '#12061f', surface: '#2a1445', surface2: '#381c5b',
      border: '#573082', borderSoft: '#381e57',
      text: '#fbeefb', textDim: '#c3a8d8', textFaint: '#8b74a2',
      good: '#34d3c0', goodSoft: '#08302c',
      resetBorder: '#fbeefb', resetBg: '#381c5b', resetText: '#fbeefb',
    },
    rosie: {
      // Softened toward a true pastel pink (like a Sonic love-interest's hair/fur) rather than
      // hot magenta — accent lightened/desaturated, and bg/surface hue nudged warmer (less blue)
      // so the dark backdrop reads as deep rose rather than wine/magenta.
      label: 'Rosie', accent: '#f78fb3',
      swatch: 'linear-gradient(135deg, #f78fb3 0 38%, #e0303a 38% 62%, #ffffff 62% 100%)',
      bg: '#1f0912', surface: '#3d1522', surface2: '#4f1c2c',
      border: '#8a3550', borderSoft: '#5a2436',
      text: '#fff0f5', textDim: '#e3b5c6', textFaint: '#a67c8c',
      good: '#4fd07d', goodSoft: '#0c2c1a',
      resetBorder: '#fff0f5', resetBg: '#4f1c2c', resetText: '#fff0f5',
    },
    kos: {
      label: 'K-Os', accent: '#55d4ff',
      swatch: 'linear-gradient(135deg, #55d4ff 0 38%, #a6e22e 38% 62%, #ffffff 62% 100%)',
      bg: '#03151a', surface: '#093740', surface2: '#0d4655',
      border: '#1d6d80', borderSoft: '#114452',
      text: '#e8fbff', textDim: '#97c6d3', textFaint: '#5f8a97',
      good: '#a6e22e', goodSoft: '#1b2e08',
      resetBorder: '#e8fbff', resetBg: '#0d4655', resetText: '#e8fbff',
    },
  },
  // Cartomancer is a MAIN COLOR aesthetic (see FULL_PALETTE_AESTHETICS): each entry is one of
  // the five mana colors, renamed after its philosophy rather than the literal color name
  // (Protection/Control/Death/Rapidity/Growth) — same reason Hedge never says "Sonic": stylistic
  // inspiration, not the trademarked names. All five keep a dark backdrop (no light-theme token
  // flip, matching every MAIN COLOR aesthetic except Liminal) — the color identity comes through
  // accent/--good/panel tint, not a literal bright background.
  cartomancer: {
    protection: { // White — Plains, order, angels
      label: 'Protection', accent: '#f0dfa0',
      bg: '#120f08', surface: '#241d10', surface2: '#332816',
      border: '#5c4a28', borderSoft: '#3a2f18',
      text: '#f7efd8', textDim: '#c9bb92', textFaint: '#8a7c58',
      good: '#8fc97a', goodSoft: '#1c2c16',
      resetBorder: '#f7efd8', resetBg: '#332816', resetText: '#f7efd8',
    },
    control: { // Blue — Islands, knowledge, illusion
      label: 'Control', accent: '#4aa8e8',
      bg: '#050e16', surface: '#0d1f2c', surface2: '#12303f',
      border: '#255472', borderSoft: '#173a4e',
      text: '#d9f0fb', textDim: '#8fb8cc', textFaint: '#547d8f',
      good: '#5adbc4', goodSoft: '#0d2e28',
      resetBorder: '#d9f0fb', resetBg: '#12303f', resetText: '#d9f0fb',
    },
    death: { // Black — Swamp, decay, power
      label: 'Death', accent: '#8452b8',
      bg: '#0a0610', surface: '#160d24', surface2: '#201433',
      border: '#4a2e66', borderSoft: '#2e1d40',
      text: '#ece3f5', textDim: '#b19bc9', textFaint: '#71618a',
      good: '#7dd490', goodSoft: '#16281c',
      resetBorder: '#ece3f5', resetBg: '#201433', resetText: '#ece3f5',
    },
    rapidity: { // Red — Mountain, chaos, speed
      label: 'Rapidity', accent: '#e8562a',
      bg: '#140704', surface: '#2a120a', surface2: '#3a190d',
      border: '#7a3318', borderSoft: '#4a2010',
      text: '#fce8dd', textDim: '#d9a68f', textFaint: '#94614a',
      good: '#f5c542', goodSoft: '#33280a',
      resetBorder: '#fce8dd', resetBg: '#3a190d', resetText: '#fce8dd',
    },
    growth: { // Green — Forest, nature, growth
      label: 'Growth', accent: '#4a9450',
      bg: '#070f08', surface: '#101f12', surface2: '#172e1a',
      border: '#2e5a34', borderSoft: '#1c3a20',
      text: '#e2f2e0', textDim: '#a8c9a6', textFaint: '#6b8f68',
      good: '#d9b24a', goodSoft: '#332908',
      resetBorder: '#e2f2e0', resetBg: '#172e1a', resetText: '#e2f2e0',
    },
  },
};
function prefersDarkTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light') return false;
  if (explicit === 'dark') return true;
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
// Aesthetics: whole-app looks layered on top of the accent-color system. Every aesthetic has its
// own curated accent palette in AESTHETIC_ACCENTS above, plus a fixed backdrop, font stack and
// corner radius via a `:root[data-aesthetic]` CSS block, deliberately ignoring the device's
// light/dark system setting so switching to one always looks the same regardless of device theme.
// Every aesthetic belongs to exactly one named group, and groups render as collapsible sections in
// that same declared order (see AESTHETIC_GROUP_ORDER / renderAestheticOptions).
const AESTHETICS = {
  terminal:  { label: 'Retro Terminal',   desc: 'Monospace CLI on near-black with scanlines — pick your own phosphor color below.', group: 'Vibrant' },
  cyberpunk: { label: 'Cyberpunk Neon',   desc: 'Glowing neon UI on deep purple-navy, night-city energy.', group: 'Vibrant' },
  brutalist: { label: 'Neo-Brutalist',    desc: 'Raw concrete, thick black borders, hard offset shadows.', group: 'Contrast' },
  editorial: { label: 'Luxury Editorial', desc: 'Serif headlines on warm cream, with a single gold accent.', group: 'Light' },
  soft:      { label: 'Soft Minimal',     desc: 'Airy off-white, muted pastels, rounded hairline edges.', group: 'Light' },
  academia:  { label: 'Dark Academia',    desc: 'Ornate serif on aged parchment, Vitruvian sepia and brass tones.', group: 'Light' },
  sakura:    { label: 'Sakura',           desc: 'Pale cherry blossom pink and white, soft and airy.', group: 'Light' },
  honey:     { label: 'Hunny',            desc: 'Warm honeycomb amber and cream, cozy and glowing.', group: 'Light' },
  gutterslime: { label: 'Gutterslime',    desc: 'Matte dark-green industrial shell with glowing toxic neon and a diamond-plate floor.', group: 'Vibrant' },
  spookyscary: { label: "Jack-o'-Lantern", desc: 'Halloween night carved in pumpkin glow — warm amber light, deep violet shadow, witch-green trim.', group: 'Vibrant' },
  thrash:    { label: 'Thrash Metal',     desc: 'Studded black leather and amp-stack grit — yellow, chrome and blood red under stage light.', group: 'Vibrant' },
  sixiang:   { label: 'Four Symbols',     desc: 'Sì Xiàng guardians of the four directions — pick Azure Dragon, Vermilion Phoenix, White Tiger or Black Tortoise below.', group: 'Vibrant' },
  // `external: true` means this one's CSS lives in aesthetics/<key>/theme.css and is fetched
  // only when it's actually selected, instead of riding along in styles.css for everyone.
  // Maximalist themes are heavy enough (gradient stacks, gloss, their own keyframes/fonts)
  // that this is worth it; the original twelve stay inline. See applyAestheticStylesheet().
  frutigeraero: { label: 'Frutiger Aero', desc: 'Mid-2000s optimism — sky-to-grass gradient, glossy Aero glass, drifting bubbles.', group: 'Maximalist', external: true },
  y2k:          { label: 'Y2K Chrome',    desc: 'Liquid metal on near-black — mirror-chrome bevels, oil-slick iridescence, travelling glints.', group: 'Maximalist', external: true },
  // `fx: true` additionally loads aesthetics/draconic/fx.js (compiled from fx.ts) for the
  // tap-ember particle burst — see applyAestheticFX().
  draconic:     { label: 'Draconic',      desc: 'Scorched black and dragonfire — gilded scale plate, footprint tiles, embers on every hot tap.', group: 'Maximalist', external: true, fx: true },
  cream:        { label: 'C.R.E.A.M',     desc: 'Pinstripe purple and gold — a set of chaos emeralds for tiles, gilded controls, sharp suiting.', group: 'Maximalist', external: true },
  // Metalheart's fx.js is the odd one out: it draws nothing, it only writes --mh-px/--mh-py for
  // the cable field's parallax. The field renders static without it, so this stays a pure
  // enhancement — see aesthetics/metalheart/fx.ts.
  metalheart:   { label: 'Metalheart',    desc: 'Chrome tendrils in a black room — gunmetal glass, cerulean and viridian rim light, survey marks over grime.', group: 'Maximalist', external: true, fx: true },
  // No `fx: true` here on purpose: everything that moves (the ball, its light spots, the floor
  // sweep, the chase bulbs) is a CSS animation. A mirror ball never stops, and an always-on rAF
  // loop would break the demand-driven rule every FX module is held to — CSS is the right tool
  // for permanent ambient motion, and it pauses itself when the tab is hidden.
  millennium:   { label: 'Millennium Disco', desc: 'Mirrorball light on a lit checkerboard floor — stepped neon frames, running bulbs, and a vibe you pick below.', group: 'Maximalist', external: true },
  // Second ambient FX module (after Metalheart): fx.js draws nothing, it only writes
  // --rn-px/--rn-py so theme.css can parallax the sword. The sword still hangs there without
  // it — see aesthetics/runic/fx.ts.
  runic:        { label: 'Runic',         desc: 'Elder Futhark carved into a slate wall and waking rune by rune — oak panels, silver filigree, and a rune-lit blade in the dark.', group: 'Maximalist', external: true, fx: true },
  // Third ambient FX module. fx.js writes one offset pair, --lm-px/--lm-py, and each of the
  // four wall planes multiplies it by its own depth fraction — see aesthetics/liminal/fx.ts.
  liminal:      { label: 'Liminal',       desc: 'You have been here before. Mono-yellow wallpaper down four doorways, lit ceiling panels, and one fluorescent that keeps going.', group: 'Maximalist', external: true, fx: true },
  // MAIN COLOR aesthetic (see FULL_PALETTE_AESTHETICS) — the SECTOR picker swaps the whole
  // deep-space palette. Fourth ambient FX module: fx.js writes one offset pair --sh-px/--sh-py
  // and each scene plane multiplies it by its own depth fraction — see aesthetics/spacehighway/fx.ts.
  spacehighway: { label: 'Space Highway', desc: 'Behind the wheel on a neon highway running into deep space — lane lines streaming past, a cosmic swirl through the windshield, a saucer now and then, and an alien nodding on the dash.', group: 'Maximalist', external: true, fx: true },
  // MAIN COLOR aesthetic (see FULL_PALETTE_AESTHETICS) — the CHARACTER picker swaps the whole
  // palette to whoever you picked. Fifth ambient FX module: fx.js draws nothing, it writes one
  // offset pair --hg-px/--hg-py into the ring's `translate` while the spin stays a CSS
  // animation on `rotate`, so the ring still hangs and still turns with the module absent —
  // see aesthetics/hedge/fx.ts.
  hedge:        { label: 'Hedge',         desc: 'Gotta go fast — a gold ring turning over a drift of out-of-focus lights, menu bars scanned with stripes inside a bright inner border, and hard italic headers. Pick your character below and the whole scene changes colour.', group: 'Maximalist', external: true, fx: true },
  // MAIN COLOR aesthetic (see FULL_PALETTE_AESTHETICS) — the MANA COLOR picker swaps the whole
  // card-frame palette. Its fx module is a PARTICLE module (drifting mana motes) but continuous
  // rather than tap-triggered like Draconic's — see aesthetics/cartomancer/fx.ts and
  // checkContinuousParticleModule() in test_aesthetic_fx.js, which needed a third FX shape for it.
  cartomancer:  { label: 'Cartomancer',   desc: 'Every panel a card in its own frame — thick colored border, a rules-text box, drifting mana motes, and the occasional panel catching a foil shimmer like you just pulled a rare. Pick your color below.', group: 'Maximalist', external: true, fx: true },
};
const AESTHETIC_GROUP_ORDER = ['Maximalist', 'Vibrant', 'Contrast', 'Light'];
// Which groups are expanded in the settings panel right now — session-only (not persisted).
// Starts (and is reset by openSetup(), below) all-closed: with 20+ aesthetics across four
// groups, "everything open" meant a long scroll past every card before reaching anything else in
// Settings. Collapsed by default trades that for one tap to open whichever group you want.
function currentAesthetic() {
  const key = STATE.settings && STATE.settings.aesthetic;
  // Falls back to the default (Cyberpunk Neon) if the stored choice is a retired aesthetic (e.g.
  // from a save made before one was removed) rather than rendering with no matching styles at all.
  return (key && AESTHETICS[key]) ? key : 'cyberpunk';
}
// The original twelve aesthetics are plain token blocks living in styles.css, so switching to
// one is just a data-attribute flip. The maximalist ones are big enough (gradients, bevels,
// masks, their own keyframes) that shipping all of them to render one would be wasteful, so an
// aesthetic can instead declare `external: true` and keep its CSS in aesthetics/<key>/theme.css,
// fetched only the first time it's actually chosen. The <link id="aestheticCss"> in index.html
// is the single slot they load into — swapping its href swaps the whole theme.
// See docs/ARCHITECTURE.md > "Aesthetic file layout".
function applyAestheticStylesheet(key) {
  const link = document.getElementById('aestheticCss');
  if (!link) return;
  const meta = AESTHETICS[key];
  const href = (meta && meta.external) ? `aesthetics/${key}/theme.css` : null;
  if (!href) { link.removeAttribute('href'); return; }
  // Re-setting an identical href would re-trigger a load and flash the theme; skip that.
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}
// Some aesthetics need behaviour CSS can't express (particles, pointer-reactive effects). Those
// declare `fx: true` and ship aesthetics/<key>/fx.js — a real ES module, compiled from fx.ts by
// `npm run build:fx` — default-exporting an AestheticFX ({key, init, destroy}). It's imported
// lazily the first time that aesthetic is chosen and torn down before switching away, so a
// theme's animation loop can never outlive the theme. See docs/ARCHITECTURE.md.
let ACTIVE_FX = null;   // { key, mod } for the module currently running, or null
let FX_LOAD_SEQ = 0;    // guards against a slow import landing after another switch
function applyAestheticFX(key) {
  const meta = AESTHETICS[key];
  const wants = !!(meta && meta.fx);
  if (ACTIVE_FX && ACTIVE_FX.key !== key) {
    try { ACTIVE_FX.mod.destroy(); } catch (e) { console.warn('FX destroy failed', e); }
    ACTIVE_FX = null;
  }
  if (!wants || (ACTIVE_FX && ACTIVE_FX.key === key)) return;
  const seq = ++FX_LOAD_SEQ;
  // Resolved against the DOCUMENT, not this script. A dynamic import()'s specifier is relative to
  // the importing script's own URL, so the bare `./aesthetics/...` this used to be started
  // resolving to src/aesthetics/... the moment this code moved into src/ — silently, since the
  // failed import is caught below and the theme still renders without its effects. Going through
  // document.baseURI makes it location-independent and keeps working under a project subpath
  // (GitHub Pages serves this from /lifemanager/), which a leading-slash path would not.
  import(new URL(`aesthetics/${key}/fx.js`, document.baseURI).href).then((m) => {
    const fx = m && m.default;
    // Bail if the user has moved on since, or the module isn't shaped like the contract.
    if (seq !== FX_LOAD_SEQ || currentAesthetic() !== key) return;
    if (!fx || typeof fx.init !== 'function' || typeof fx.destroy !== 'function') {
      console.warn(`aesthetics/${key}/fx.js does not export an AestheticFX`);
      return;
    }
    fx.init(document.body); // <body>, not #app — #app.innerHTML is replaced on every render
    ACTIVE_FX = { key, mod: fx };
  }).catch(() => {
    // No module, offline, or a file:// page (ES modules can't load from file://). The theme is
    // still fully usable — it just renders without its runtime effects.
  });
}
function applyAesthetic() {
  const key = currentAesthetic();
  applyAestheticStylesheet(key);
  applyAestheticFX(key);
  document.documentElement.dataset.aesthetic = key;
  applyAccentColor(); // every aesthetic now owns its own accent choice
}
function setAesthetic(key) {
  if (!AESTHETICS[key]) return;
  if (!STATE.settings) STATE.settings = defaultState().settings;
  STATE.settings.aesthetic = key;
  saveState();
  applyAesthetic();
  renderAestheticOptions();
  renderAccentSwatches();
  render();
  drawWeightChart();
}
function aestheticCardHtml(key) {
  const a = AESTHETICS[key];
  const active = key === currentAesthetic();
  return `<button class="aesthetic-card ${active?'active':''}" onclick="setAesthetic('${key}')">
    <div class="aesthetic-card-preview aesthetic-preview-${key}"></div>
    <div>
      <div class="aesthetic-card-name">${a.label}</div>
      <div class="aesthetic-card-desc">${a.desc}</div>
    </div>
    ${active ? `<span class="aesthetic-card-check">${icon('check')}</span>` : ''}
  </button>`;
}
function toggleAestheticGroup(name) {
  if (VIEW.aestheticGroupsOpen.has(name)) VIEW.aestheticGroupsOpen.delete(name);
  else VIEW.aestheticGroupsOpen.add(name);
  renderAestheticOptions();
  // The group just opened (or closed) may be the one holding the active aesthetic's inline
  // accent picker (see aestheticGroupCardsHtml()) — repopulate it now that its container has
  // just been freshly created (or discarded). renderAccentSwatches() no-ops safely if the
  // #accentSwatchGrid it looks for isn't currently in the DOM (group collapsed).
  renderAccentSwatches();
}
// Cards for one group, with the ACCENT COLOR / MAIN COLOR / etc. picker inlined directly after
// whichever card is the currently active aesthetic — instead of one picker in a fixed spot at
// the bottom of the whole screen, it now travels with the selection so there's no separate
// scroll down to it. See renderAccentSwatches() for what fills the (initially empty) picker ids.
function aestheticGroupCardsHtml(keys) {
  const active = currentAesthetic();
  return keys.map(key => aestheticCardHtml(key) + (key === active ? `
    <div class="accent-picker-inline">
      <div class="subtle-label" id="accentColorLabel" style="margin-bottom:6px;">ACCENT COLOR</div>
      <div id="accentColorNote" style="font-size:11px; color:var(--text-faint); margin-bottom:10px;"></div>
      <div class="accent-swatch-grid" id="accentSwatchGrid"></div>
    </div>` : '')).join('');
}
function renderAestheticOptions() {
  const wrap = document.getElementById('aestheticOptions');
  if (!wrap) return;
  let html = '';
  for (const groupName of AESTHETIC_GROUP_ORDER) {
    const keys = Object.keys(AESTHETICS).filter(k => AESTHETICS[k].group === groupName);
    if (!keys.length) continue;
    const open = VIEW.aestheticGroupsOpen.has(groupName);
    html += `<div class="aesthetic-group">
      <button class="aesthetic-group-header" onclick="toggleAestheticGroup('${groupName}')">
        <span>${groupName}</span>${open ? icon('up') : icon('down')}
      </button>
      ${open ? `<div class="aesthetic-group-list">${aestheticGroupCardsHtml(keys)}</div>` : ''}
    </div>`;
  }
  wrap.innerHTML = html;
}
// Which accent key is selected within the CURRENT aesthetic's own palette. Falls back to that
// palette's first entry, so a fresh aesthetic always has a sane color picked already.
function currentAccentKey() {
  const aesthetic = currentAesthetic();
  const pal = AESTHETIC_ACCENTS[aesthetic];
  const map = (STATE.settings && STATE.settings.accentByAesthetic) || {};
  let key = map[aesthetic];
  if (!key || !pal[key]) key = Object.keys(pal)[0];
  return key;
}
// Retro Terminal's MAIN COLOR choice and Four Symbols' guardian choice both re-theme the whole
// look, not just --accent — these are the custom properties they override via inline style.
// Cleared on every other aesthetic so a prior full-palette choice never leaks into a different
// aesthetic's CSS-block colors.
const TERMINAL_PALETTE_VARS = ['--bg', '--surface', '--surface2', '--border', '--border-soft', '--text', '--text-dim', '--text-faint', '--good', '--good-soft', '--reset-border', '--reset-bg', '--reset-text'];
// Aesthetics whose accent-palette entries are full mini-palettes (see TERMINAL_PALETTE_VARS above)
// rather than a single `value` color — Retro Terminal's phosphor colors and Four Symbols' guardians.
const FULL_PALETTE_AESTHETICS = new Set(['terminal', 'sixiang', 'cream', 'millennium', 'spacehighway', 'hedge', 'cartomancer']);
// What the picker calls itself for each full-palette aesthetic. Everything else gets the
// default "ACCENT COLOR" heading — this map is only for aesthetics where the choice repaints
// the whole app rather than tinting one colour.
const PALETTE_PICKER_COPY = {
  terminal: { label: 'MAIN COLOR', note: 'Recolors the whole terminal — background, borders and every shade of text.' },
  sixiang:  { label: 'GUARDIAN',   note: 'Choose your guardian — each recolors the whole app, background, borders and every shade of text.' },
  cream:    { label: 'MAIN COLOR', note: 'Swap the suit between regal purple and dollar green — gold stays, and the button colour swaps to whichever hue the suit is not.' },
  millennium: { label: 'VIBE', note: 'Relights the whole room — floor, frames, bulbs and every shade of text. Each vibe is a pair of hues, and the stepped frames run between them.' },
  hedge: { label: 'CHARACTER', note: "Pick who you're playing as — each one repaints the whole app in the three colours they're drawn in, from the backdrop and borders to every shade of text." },
  spacehighway: { label: 'SECTOR', note: "Pick the sector of space the highway runs through — it recolours everything from the deep-space backdrop and the star field to every shade of text. The road, Saturn and the cars stay as they are." },
  cartomancer: { label: 'MANA COLOR', note: "Pick a color's philosophy — each recolors the whole card frame, background, borders and every shade of text." },
};
function applyAccentColor() {
  const aesthetic = currentAesthetic();
  const pal = AESTHETIC_ACCENTS[aesthetic];
  const c = pal[currentAccentKey()];
  const root = document.documentElement.style;
  if (FULL_PALETTE_AESTHETICS.has(aesthetic)) {
    root.setProperty('--bg', c.bg);
    root.setProperty('--surface', c.surface);
    root.setProperty('--surface2', c.surface2);
    root.setProperty('--border', c.border);
    root.setProperty('--border-soft', c.borderSoft);
    root.setProperty('--text', c.text);
    root.setProperty('--text-dim', c.textDim);
    root.setProperty('--text-faint', c.textFaint);
    root.setProperty('--good', c.good);
    root.setProperty('--good-soft', c.goodSoft);
    root.setProperty('--reset-border', c.resetBorder);
    root.setProperty('--reset-bg', c.resetBg);
    root.setProperty('--reset-text', c.resetText);
    root.setProperty('--accent', c.accent);
  } else {
    TERMINAL_PALETTE_VARS.forEach(v => root.removeProperty(v));
    root.setProperty('--accent', c.value);
  }
}
function setAccentColor(key) {
  const aesthetic = currentAesthetic();
  const pal = AESTHETIC_ACCENTS[aesthetic];
  if (!pal[key]) return;
  if (!STATE.settings) STATE.settings = defaultState().settings;
  if (!STATE.settings.accentByAesthetic) STATE.settings.accentByAesthetic = {};
  STATE.settings.accentByAesthetic[aesthetic] = key;
  saveState();
  applyAccentColor();
  renderAccentSwatches();
  render();
  drawWeightChart();
}
function renderAccentSwatches() {
  const grid = document.getElementById('accentSwatchGrid');
  const note = document.getElementById('accentColorNote');
  const label = document.getElementById('accentColorLabel');
  if (!grid) return;
  const aesthetic = currentAesthetic();
  const pal = AESTHETIC_ACCENTS[aesthetic];
  const current = currentAccentKey();
  const copy = PALETTE_PICKER_COPY[aesthetic];
  if (label) label.textContent = copy ? copy.label : 'ACCENT COLOR';
  if (note) note.textContent = copy ? copy.note : `Colors curated for ${AESTHETICS[aesthetic].label}.`;
  grid.innerHTML = Object.keys(pal).map(key => {
    const c = pal[key];
    const sw = c.swatch || c.value || c.accent;
    return `<div class="accent-swatch-item">
      <button class="accent-swatch ${key===current?'active':''}" style="--sw:${sw}" onclick="setAccentColor('${key}')" title="${c.label}" aria-label="${c.label}"></button>
      <div class="accent-swatch-label">${c.label.toUpperCase()}</div>
    </div>`;
  }).join('');
}
if (window.matchMedia) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onSchemeChange = () => { applyAccentColor(); renderAccentSwatches(); };
  if (mql.addEventListener) mql.addEventListener('change', onSchemeChange);
  else if (mql.addListener) mql.addListener(onSchemeChange);
}
