// test_overlay_layering.js — a modal has to actually be on top, in every aesthetic.
//
// The bug, reported 2026-09-18 from a phone: the Phase editor opened UNDER the top bar. Its title
// input was invisible and untappable — taps landed on the wordmark behind it — and its DONE button
// was under the tab bar. Dragging the visible part just scrolled the page.
//
// The cause is a two-part trap that no single file looks wrong on its own:
//   * All eleven aesthetics set `#app { position: relative; z-index: 1 }`, because each paints its
//     backdrop (bubbles, a spinning ring, doorways) in #app's own pseudo-elements and needs them to
//     layer behind the content. Entirely reasonable.
//   * That makes #app a STACKING CONTEXT, which is a ceiling. Nothing inside #app can paint above a
//     SIBLING of #app, whatever z-index it asks for. `.topbar` (20) and `.tabbar` (30) are siblings.
// So `.modal-overlay { z-index: 100 }` rendered from inside a screen lost to a bar at 20. Thirteen
// overlays were rendered that way; the Phase editor is simply the first that was full-height with a
// control in the top 52px, which is why it was the one that got noticed.
//
// The fix is that overlays leave #app: _hoistOverlays() moves them to #overlayRoot, a plain child
// of <body>, which is where every overlay declared in index.html already lived — and exactly why
// #confirmOverlay and #imageLightboxOverlay never had this problem.
//
// What's pinned:
//   1. The hoist list has not fallen behind styles.css — derived from the stylesheet, not restated.
//   2. Every overlay the app renders ends up OUTSIDE #app when open.
//   3. The Phase editor's title input is genuinely hit-testable — in ALL eleven aesthetics. This is
//      the check that actually reproduces the report; #2 alone would pass on a broken build if the
//      bars were ever raised instead.
//   4. Closing an overlay cleans up: #overlayRoot empties, nothing is left floating over the app.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const fs = require('fs');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    return route.abort();
  });
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // ---- 1. The hoist list still matches the stylesheet ----
  // OVERLAY_SELECTOR in app-shell.js is a list of class names, and a list is a second place to
  // remember. So it is not trusted here: the expected set is re-derived from styles.css by finding
  // every rule that declares `position: fixed` with a z-index above .tabbar's 30. Anything that
  // floats above the bars is an overlay by definition, and either it is hoisted or it already lives
  // at body level in index.html.
  // The derived criterion is `position: fixed` + `inset: 0` — a FULL-VIEWPORT layer. That is the
  // unambiguous shape of "this is meant to cover the app, bars included", and it is what separates
  // a real overlay from screen furniture that merely floats: `.fab` (z 35) and `.rest-timer-fab`
  // (z 35) are also fixed and also above the tab bar's 30, but they are positioned to CLEAR the bar
  // rather than cover it, and hoisting them out of the screen they belong to would be wrong. The
  // panels that pair with a backdrop (.link-picker, .entry-preview) are not derivable this way and
  // are covered instead by opening them for real, below.
  //
  // Comments are stripped FIRST. Without that, a rule preceded by a `/* ... */` block has the whole
  // comment swept into its selector capture and the class is silently skipped — which quietly
  // exempted `.modal-overlay` itself, the single most important entry, when this was first written.
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const src = fs.readdirSync(path.resolve(__dirname, '..', 'src'))
    .map(f => fs.readFileSync(path.resolve(__dirname, '..', 'src', f), 'utf8')).join('\n');
  const floating = new Set();
  // Rules only — `.a, .b { ... }`. Pseudo-element decorations (aesthetic scanlines and the like)
  // are skipped: they are `pointer-events: none` and belong to no screen.
  css.replace(/([^{}]+)\{([^{}]*)\}/g, (_m, sel, body) => {
    if (!/position:\s*fixed/.test(body) || !/inset:\s*0/.test(body)) return '';
    const z = /z-index:\s*(\d+)/.exec(body);
    if (!z || Number(z[1]) <= 30) return '';
    if (/::(before|after)/.test(sel)) return '';
    if (/pointer-events:\s*none/.test(body)) return '';   // a decoration, not a layer you can touch
    sel.split(',').forEach(s => {
      const m = s.trim().match(/^\.([a-z0-9-]+)$/i);
      if (m) floating.add(m[1]);
    });
    return '';
  });
  // Two ways an overlay can already be at body level, neither of which needs hoisting:
  //   * index.html declares it (#confirmOverlay, #imageLightboxOverlay, #restPickerOverlay, #toast)
  //   * JS builds the node and appends it to document.body itself — the drag ghosts and the break
  //     flash, which are transient effects belonging to no screen.
  // The second list is explicit rather than inferred, and each entry is verified below to really
  // contain a document.body.appendChild. A new screen-rendered overlay therefore cannot slip
  // through by accident: it will not be in either list, and this check will name it.
  const BODY_APPENDED = ['break-flash', 'exercise-chip-ghost', 'home-drag-ghost'];
  BODY_APPENDED.forEach(c => {
    const file = src.split('\n');
    const at = file.findIndex(l => l.includes(c));
    const near = file.slice(at, at + 12).join('\n');
    if (at < 0 || !/document\.body\.appendChild/.test(near)) {
      throw new Error(`.${c} is exempted here as body-appended, but no document.body.appendChild follows it — the exemption is stale`);
    }
  });
  // A class must be hoisted if a SCREEN emits it — i.e. it appears as rendered markup in src/*.js.
  // Being declared in index.html is not an exemption on its own: `.modal-overlay` is both (it is
  // #confirmOverlay's class AND what renderPhaseEditorModal() emits), and treating the index.html
  // appearance as proof of body-level would have exempted the very class this whole file is about.
  const emittedByAScreen = (c) => new RegExp(`class="[^"]*\\b${c}\\b`).test(src);
  const mustHoist = [...floating].filter(c => emittedByAScreen(c) && BODY_APPENDED.indexOf(c) < 0);
  const bodyLevel = [...floating].filter(c => mustHoist.indexOf(c) < 0);
  const declared = await page.evaluate(() => OVERLAY_SELECTOR.split(',').map(s => s.trim().replace(/^\./, '')));
  console.log('1. floats above the bars:', [...floating].sort().join(', '));
  console.log('1. already at body level:', bodyLevel.sort().join(', '));
  console.log('1. must be hoisted:', mustHoist.sort().join(', '));
  console.log('1. OVERLAY_SELECTOR says:', declared.sort().join(', '));
  const missing = mustHoist.filter(c => declared.indexOf(c) < 0);
  if (missing.length) {
    throw new Error('styles.css floats these above the bars but _hoistOverlays() does not move them, '
      + 'so they will render UNDER the top bar: ' + missing.join(', '));
  }

  // ---- 2 & 3. Every overlay, opened for real ----
  // Each entry opens one overlay and names a control that must be tappable. `.modal-overlay` etc.
  // being outside #app is necessary but not sufficient — what the report was actually about is
  // whether your finger reaches the control, so that is what gets asserted.
  const OVERLAYS = [
    { name: 'phase editor', sel: '.phase-modal',
      open: () => { switchTab('train'); setFitnessSubtab('phases'); openPhaseCard((STATE.phases || [])[0].id); },
      hit: '.phase-modal-head .phase-label' },
    { name: 'AM/PM log sheet', sel: '.home-popup-backdrop',
      open: () => { switchTab('home'); openLogPopup(Object.keys(LOG_FIELDS)[0]); } },
    { name: 'link picker', sel: '.link-picker',
      open: () => { switchTab('home'); openLinkPicker('note', 'x'); } },
  ];
  for (const o of OVERLAYS) {
    await page.evaluate(`(${o.open.toString()})()`);
    await settle(page);
    const r = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };
      return {
        found: true,
        insideApp: !!document.getElementById('app').querySelector(sel),
        inOverlayRoot: !!document.getElementById('overlayRoot').querySelector(sel),
      };
    }, o.sel);
    console.log(`2. ${o.name}:`, JSON.stringify(r));
    if (!r.found) throw new Error(`${o.name} did not open — the fixture is wrong, not the app`);
    if (r.insideApp) throw new Error(`${o.name} is still inside #app, where a stacking context buries it under the bars`);
    if (!r.inOverlayRoot) throw new Error(`${o.name} should have been hoisted to #overlayRoot`);
    await page.evaluate(() => { closePhaseCard && UI.phaseOpen !== undefined && (UI.phaseOpen = PHASE_NONE_OPEN); UI.logPopup = null; LINK_PICKER = null; render(); });
    await settle(page);
  }
  // ...and closing really does clear the host, rather than leaving an invisible layer over the app.
  const emptied = await page.evaluate(() => document.getElementById('overlayRoot').children.length);
  console.log('2. overlayRoot after closing everything:', emptied);
  if (emptied) throw new Error('Closing an overlay must empty #overlayRoot — a stale backdrop eats every tap');

  // ---- 2b. An overlay must not SURVIVE navigation ----
  // The follow-up report, 2026-09-18: "going into PHASES from outside, you can't scroll the screen
  // until you tap a text box." Nothing was wrong with the scroll. The phase editor had been left
  // open, its id lived in VIEW (which deliberately survives navigation, unlike UI), and returning
  // to PHASES re-rendered it — a full-viewport fixed sheet swallowing every touch. Hoisting made a
  // pre-existing bug catastrophic: the same stale modal used to be buried under the bars.
  //
  // So this asserts the property rather than the field: leave the screen, come back, and there is
  // nothing floating over it. Both ways of leaving are checked — another SECTION (switchTab) and
  // another SUBTAB of the same section (setFitnessSubtab), because only the first reset anything.
  const leaveAndReturn = [
    { name: 'another section', go: () => { switchTab('home'); }, back: () => { switchTab('train'); setFitnessSubtab('phases'); } },
    { name: 'another subtab', go: () => { setFitnessSubtab('builder'); }, back: () => { setFitnessSubtab('phases'); } },
    { name: 'Back button', go: () => { switchTab('home'); }, back: () => { goBack(); } },
  ];
  for (const t of leaveAndReturn) {
    await page.evaluate(() => { switchTab('train'); setFitnessSubtab('phases'); openPhaseCard((STATE.phases || [])[0].id); });
    await settle(page);
    const opened = await page.evaluate(() => !!document.querySelector('.phase-modal'));
    if (!opened) throw new Error('Setup: the editor should be open before leaving');
    await page.evaluate(`(${t.go.toString()})()`);
    await settle(page);
    await page.evaluate(`(${t.back.toString()})()`);
    await settle(page);
    const r = await page.evaluate(() => {
      const se = document.scrollingElement;
      return {
        stale: [...document.getElementById('overlayRoot').children].map(e => e.className),
        // The symptom as described: a mid-screen tap lands on the sheet instead of the page.
        atMid: (document.elementFromPoint(195, 400) || {}).className || null,
        scrollable: se.scrollHeight > se.clientHeight,
      };
    });
    console.log(`2b. left via ${t.name}, returned:`, JSON.stringify(r));
    if (r.stale.length) {
      throw new Error(`Leaving PHASES via ${t.name} left an overlay open; coming back re-renders it over the whole screen: ` + JSON.stringify(r.stale));
    }
  }

  // ---- 2c. An overlay's scroll position survives a re-render ----
  // Reported 2026-09-18: "navigating into PHASES and editing or making NEW still has strange scroll
  // issues." Every control in the phase editor commits on change, so every change re-renders, and a
  // render rebuilds the overlay from markup — a brand-new scroll container, starting at 0. Scroll
  // down to a field, change it, and you are thrown back to the top. Same problem
  // _captureSubnavScroll() solves for the sub-nav strips, one layer up.
  await page.evaluate(() => {
    switchTab('train'); setFitnessSubtab('phases');
    addPhase();   // opens the editor on the phase it just made — the "making NEW" path
  });
  await settle(page);
  const scrollable = await page.evaluate(() => {
    const b = document.querySelector('.phase-modal-body');
    return b && b.scrollHeight > b.clientHeight;
  });
  if (!scrollable) throw new Error('This check needs an editor taller than its box to mean anything');
  await page.evaluate(() => { document.querySelector('.phase-modal-body').scrollTop = 200; });
  await page.waitForTimeout(50);
  const parked = await page.evaluate(() => document.querySelector('.phase-modal-body').scrollTop);
  // A real edit, through the app's own handler rather than a direct render() call.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.phase-actions button')].find(x => /\+1 WK/.test(x.textContent));
    b.click();
  });
  await settle(page);
  const kept = await page.evaluate(() => ({
    top: document.querySelector('.phase-modal-body').scrollTop,
    contains: getComputedStyle(document.querySelector('.phase-modal-body')).overscrollBehaviorY,
  }));
  console.log('2c. modal scroll across an edit:', parked, '->', JSON.stringify(kept));
  if (!parked) throw new Error('Setup: the modal body should have scrolled');
  if (kept.top !== parked) throw new Error(`Editing threw the modal back to ${kept.top} from ${parked} — every field commits on change, so this happens on every keystroke`);
  // ...and a flick that runs out of modal must not scroll the page underneath it.
  if (kept.contains !== 'contain') throw new Error('The modal must contain its overscroll, got ' + kept.contains);

  // Closing and opening a DIFFERENT phase starts at the top rather than inheriting that offset.
  await page.evaluate(() => { closePhaseCard(); });
  await settle(page);
  await page.evaluate(() => { openPhaseCard((STATE.phases || [])[0].id); });
  await settle(page);
  const fresh = await page.evaluate(() => document.querySelector('.phase-modal-body').scrollTop);
  console.log('2c. a newly opened phase starts at:', fresh);
  if (fresh !== 0) throw new Error('A freshly opened editor starts at the top, not where the last one was: ' + fresh);
  await page.evaluate(() => { closePhaseCard(); });
  await settle(page);

  // ---- 3. The reported case, in every aesthetic ----
  // This is the one that reproduces the report. Every aesthetic gives #app its own stacking context,
  // so a fix that only worked in the default theme would still be broken on the phone.
  const aesthetics = await page.evaluate(() => Object.keys(AESTHETICS));
  const bad = [];
  for (const aes of aesthetics) {
    await page.evaluate((a) => {
      setAesthetic(a);
      switchTab('train'); setFitnessSubtab('phases');
      openPhaseCard((STATE.phases || [])[0].id);
    }, aes);
    await settle(page);
    const probe = await page.evaluate(() => {
      const input = document.querySelector('.phase-modal-head .phase-label');
      const done = document.querySelector('.phase-modal-foot button');
      if (!input) return { open: false };
      const box = input.getBoundingClientRect();
      const at = (el) => {
        const r = el.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      };
      return {
        open: true,
        onScreen: box.top >= 0 && box.bottom <= window.innerHeight,
        titleReachable: at(input) === input,
        titleBlockedBy: at(input) ? (at(input).className || at(input).tagName) : null,
        // The foot was under .tabbar (30) for the same reason the head was under .topbar (20).
        doneReachable: !done || at(done) === done,
      };
    });
    if (!probe.open || !probe.onScreen || !probe.titleReachable || !probe.doneReachable) {
      bad.push({ aes, ...probe });
    }
  }
  console.log(`3. phase editor reachable in ${aesthetics.length - bad.length}/${aesthetics.length} aesthetics`);
  if (bad.length) {
    throw new Error('The phase editor is buried under the bars in these aesthetics: ' + JSON.stringify(bad, null, 1));
  }

  await page.evaluate(() => { UI.phaseOpen = PHASE_NONE_OPEN; setAesthetic('cyberpunk'); saveState(); });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_overlay_layering.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_overlay_layering.js: FAIL\n' + e.message); process.exit(1); });
