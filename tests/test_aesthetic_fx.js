// test_aesthetic_fx.js — the AestheticFX runtime-module contract.
//
// Aesthetics with `fx: true` lazily import aesthetics/<key>/fx.js (compiled from fx.ts) and
// get init()'d; switching away must destroy() them completely. Needs a real HTTP origin —
// ES modules can't be imported from file:// — so this test serves the repo itself.
//
// It also guards the manual build: fx.js is committed, so a stale fx.js after editing fx.ts
// would silently ship old behaviour. We recompile to a temp dir and byte-compare.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// FX modules come in two shapes and the test detects which, rather than naming modules here,
// so a new fx aesthetic still needs no edits to this file:
//   particle — mounts an aria-hidden canvas on <body> and draws on it (Draconic's embers)
//   ambient  — draws nothing and writes CSS custom properties on <html> instead, which theme.css
//              consumes (Metalheart's cable-field parallax)
// Both owe the same five things: install on select, respond to input, stop when idle, tear down
// completely on switch-away, and survive being re-selected. See checkParticleModule /
// checkAmbientModule below.
//
// A control that should throw particles, and one that shouldn't (see TRIGGER_SELECTOR in each
// particle module's fx.ts). Both are common to every aesthetic.
const HOT_SELECTOR = '.btn-primary';
const COLD_SELECTOR = '#app input';
const FX_CANVAS = 'body > canvas[aria-hidden="true"]';

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (e, b) => {
      if (e) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': (MIME[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8' });
      res.end(b);
    });
  });
  return server;
}

/** Count non-transparent pixels on the FX canvas — the honest "are particles drawn" check. */
async function litPixels(page) {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel);
    if (!c) return -1;
    const g = c.getContext('2d');
    if (!g) return -1;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n;
  }, FX_CANVAS);
}

async function tapCenter(page, selector) {
  const el = await page.$(selector);
  if (!el) throw new Error(`no element matching ${selector}`);
  const b = await el.boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

/** Inline custom properties currently set on <html>, sorted. An "ambient" FX module — one that
 *  drives CSS instead of drawing, like Metalheart's cable parallax — is observable exactly here,
 *  and its destroy() has to clear them again. Note applyAccentColor() always writes --accent
 *  inline, so every caller diffs against a baseline rather than expecting an empty list. */
async function inlineCustomProps(page) {
  return page.evaluate(() => {
    const s = document.documentElement.style;
    const out = [];
    for (let i = 0; i < s.length; i++) if (s[i].startsWith('--')) out.push(s[i]);
    return out.sort();
  });
}

/** The properties this module added on top of the baseline. */
async function ownProps(page, baseProps) {
  return (await inlineCustomProps(page)).filter(p => !baseProps.includes(p));
}

async function propValues(page, names) {
  return page.evaluate(ns => ns.map(n => document.documentElement.style.getPropertyValue(n)), names);
}

/** Polls until the properties stop changing, and returns their final values — or null if they
 *  never stop.
 *
 *  This replaced a fixed `waitForTimeout(2200)` followed by an exact-equality check. The
 *  contract these modules owe is that the loop STOPS, not that it stops inside some arbitrary
 *  sleep, and how long converging takes is a property of each module: Runic eases 34px at 0.075
 *  where Metalheart eases 22px at 0.08, and the fixed budget — tuned on Metalheart — expired
 *  with Runic 0.02px from its snap and reported a phantom runaway loop. A fixed sleep just
 *  encodes one module's timing as the rule for all of them.
 *
 *  Three consecutive identical samples, not two: a slow enough tail could produce two matching
 *  reads while still creeping, since the modules round to 2dp when they write. */
async function waitUntilSettled(page, names, timeoutMs = 10000) {
  const started = Date.now();
  let prev = await propValues(page, names);
  let stable = 0;
  while (Date.now() - started < timeoutMs) {
    await page.waitForTimeout(250);
    const now = await propValues(page, names);
    stable = names.every((_, i) => now[i] === prev[i]) ? stable + 1 : 0;
    prev = now;
    if (stable >= 2) return now;
  }
  return null;
}

/** Anything a user does that an ambient module might respond to. Scroll and pointer are what
 *  the modules actually listen to; keep this generic rather than per-module. */
async function nudge(page) {
  await page.mouse.move(30, 60);
  await page.mouse.move(360, 780);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

/** Runs in the page. Has an FX module installed anything yet — either its canvas, or a custom
 *  property that was not inline on <html> before it loaded? */
function fxInstalled([sel, base]) {
  if (document.querySelector(sel)) return true;
  const s = document.documentElement.style;
  for (let i = 0; i < s.length; i++) {
    if (s[i].startsWith('--') && base.indexOf(s[i]) === -1) return true;
  }
  return false;
}

/** The canvas-drawing shape (Draconic's embers): a hot control spawns particles, a cold one
 *  doesn't, they expire on their own, and destroy() takes the canvas and the listener with it.
 *  Assumes the aesthetic is already selected; leaves the app on 'cyberpunk'. */
async function checkParticleModule(page, key) {
  const canvasId = await page.evaluate(sel => document.querySelector(sel).id, FX_CANVAS);
  console.log(`particle module loaded, canvas #${canvasId}`);

  await page.evaluate(() => switchTab('budget'));
  await page.waitForTimeout(250);

  // --- 3. A cold control draws nothing; a hot one draws particles. ---
  if (await litPixels(page) !== 0) throw new Error(`${key}: canvas should start empty`);
  await tapCenter(page, COLD_SELECTOR);
  await page.waitForTimeout(150);
  const afterCold = await litPixels(page);
  console.log('lit pixels after tapping a cold control:', afterCold);
  if (afterCold !== 0) throw new Error(`${key}: particles spawned from a control that should not trigger them`);

  await tapCenter(page, HOT_SELECTOR);
  await page.waitForTimeout(150);
  const afterHot = await litPixels(page);
  console.log('lit pixels after tapping a hot control:', afterHot);
  if (afterHot <= 0) throw new Error(`${key}: no particles spawned from a hot control`);

  // --- 4. The loop is demand-driven: particles die and the canvas clears itself. ---
  await page.waitForTimeout(2000);
  const afterSettle = await litPixels(page);
  console.log('lit pixels once the burst has burned out:', afterSettle);
  if (afterSettle !== 0) throw new Error(`${key}: particles never expired — the rAF loop may be running forever`);

  // --- 5. Switching away destroys it: canvas gone AND the listener released. ---
  await page.evaluate(() => setAesthetic('cyberpunk'));
  await page.waitForTimeout(250);
  if (await page.$(FX_CANVAS)) throw new Error(`${key}: destroy() left the canvas behind`);
  await page.evaluate(() => switchTab('budget'));
  await page.waitForTimeout(200);
  await tapCenter(page, HOT_SELECTOR); // must be inert now
  await page.waitForTimeout(150);
  if (await page.$(FX_CANVAS)) {
    throw new Error(`${key}: a tap after destroy() re-created the canvas — the pointerdown listener survived`);
  }
  console.log('destroy(): canvas removed and listener released');
}

/** The CSS-driving shape (Metalheart's cable parallax): init() writes custom properties on
 *  <html> instead of drawing, input moves them, the easing settles instead of drifting forever,
 *  and destroy() clears them and releases its listeners. Same five obligations as the particle
 *  modules, just observed through the properties rather than through pixels.
 *  Assumes the aesthetic is already selected; leaves the app on 'cyberpunk'. */
async function checkAmbientModule(page, key, baseProps) {
  const own = await ownProps(page, baseProps);
  if (!own.length) throw new Error(`${key}: fx module installed neither a canvas nor any property`);
  console.log(`ambient module loaded, writing ${own.join(' ')}`);

  await page.evaluate(() => switchTab('budget'));
  await page.waitForTimeout(250);

  // --- 3 & 4. Input moves the values, and then the loop stops on its own. ---
  const before = await propValues(page, own);
  await nudge(page);
  const settled = await waitUntilSettled(page, own);
  if (!settled) {
    throw new Error(`${key}: values never stopped changing — the rAF loop may be running forever`);
  }
  console.log(`values: [${before.join(', ')}] -> [${settled.join(', ')}], settled`);
  if (own.every((_, i) => settled[i] === before[i])) {
    throw new Error(`${key}: ${own.join(' ')} never moved under scroll/pointer input`);
  }

  // --- 5. Switching away destroys it: properties cleared AND the listeners released. ---
  await page.evaluate(() => setAesthetic('cyberpunk'));
  await page.waitForTimeout(250);
  const leftover = await ownProps(page, baseProps);
  if (leftover.length) throw new Error(`${key}: destroy() left ${leftover.join(' ')} on <html>`);
  await nudge(page);
  await page.waitForTimeout(300);
  const revived = await ownProps(page, baseProps);
  if (revived.length) {
    throw new Error(`${key}: input after destroy() rewrote ${revived.join(' ')} — a listener survived`);
  }
  console.log('destroy(): properties cleared and listeners released');
}

(async () => {
  // --- 0. The committed fx.js matches what fx.ts compiles to. ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-fx-'));
  // Call tsc's JS entrypoint with node rather than the `npx`/`tsc` shim — the .cmd shims
  // aren't directly spawnable on Windows without a shell.
  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  // --rootDir is pinned to the repo so the temp tree mirrors aesthetics/<key>/fx.js. Without
  // it tsc infers the common source root, which changes shape as soon as there's more than
  // one FX module.
  execFileSync(process.execPath,
    [tscBin, '-p', 'tsconfig.fx.json', '--outDir', tmp, '--rootDir', ROOT],
    { cwd: ROOT, stdio: 'pipe' });
  const stale = [];
  for (const dir of fs.readdirSync(path.join(ROOT, 'aesthetics'))) {
    const src = path.join(ROOT, 'aesthetics', dir, 'fx.ts');
    if (!fs.existsSync(src)) continue;
    const committed = path.join(ROOT, 'aesthetics', dir, 'fx.js');
    const fresh = path.join(tmp, 'aesthetics', dir, 'fx.js');
    if (!fs.existsSync(committed)) { stale.push(`${dir}: fx.js missing (run npm run build:fx)`); continue; }
    if (!fs.existsSync(fresh)) { stale.push(`${dir}: compiler produced no output`); continue; }
    if (fs.readFileSync(committed, 'utf8').replace(/\r\n/g, '\n') !==
        fs.readFileSync(fresh, 'utf8').replace(/\r\n/g, '\n')) {
      stale.push(`${dir}: committed fx.js is stale vs fx.ts (run npm run build:fx)`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (stale.length) throw new Error('FX build out of date:\n  ' + stale.join('\n  '));
  console.log('committed fx.js matches fx.ts for every aesthetic');

  const server = serve();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', route =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(origin + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const fxKeys = await page.evaluate(() =>
    Object.entries(AESTHETICS).filter(([, v]) => v.fx).map(([k]) => k));
  console.log('aesthetics declaring fx:', fxKeys);
  if (!fxKeys.length) throw new Error('no aesthetic declares fx:true — nothing to cover');

  // --- 1. No FX module is installed under a plain aesthetic. ---
  await page.evaluate(() => setAesthetic('cyberpunk'));
  await page.waitForTimeout(200);
  if (await page.$(FX_CANVAS)) throw new Error('an FX canvas is present under a non-fx aesthetic');
  console.log('non-fx aesthetic: no canvas (good)');

  // Baseline for the ambient check below: what is already inline on <html> with no FX module
  // running, PLUS the full-palette var names. applyAccentColor() always writes --accent, and a
  // MAIN COLOR aesthetic (one in FULL_PALETTE_AESTHETICS — e.g. Space Highway, which is also an
  // fx aesthetic) writes its whole palette inline on <html> synchronously on switch. Folding
  // those names in here means an ambient module's "own" properties come out as just its
  // parallax vars, whenever its lazy import happens to land, rather than the test racing the
  // palette write or mistaking it for the effect.
  const paletteVars = await page.evaluate(() =>
    (typeof TERMINAL_PALETTE_VARS !== 'undefined' ? TERMINAL_PALETTE_VARS : []));
  const baseProps = [...new Set((await inlineCustomProps(page)).concat(paletteVars))].sort();

  for (const key of fxKeys) {
    console.log(`\n--- ${key} ---`);

    // --- 2. Selecting the fx aesthetic loads and init()s the module. ---
    await page.evaluate(k => setAesthetic(k), key);
    await page.waitForFunction(fxInstalled, [FX_CANVAS, baseProps], { timeout: 5000 });

    if (await page.$(FX_CANVAS)) await checkParticleModule(page, key);
    else await checkAmbientModule(page, key, baseProps);

    // --- 6. Re-selecting it works again (init/destroy are repeatable). ---
    await page.evaluate(k => setAesthetic(k), key);
    await page.waitForFunction(fxInstalled, [FX_CANVAS, baseProps], { timeout: 5000 });
    console.log('re-selecting re-installs cleanly');
    await page.evaluate(() => setAesthetic('cyberpunk'));
    await page.waitForTimeout(200);
  }

  if (errors.length) throw new Error('Page errors:\n  ' + errors.join('\n  '));
  console.log('test_aesthetic_fx.js: PASS');
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
