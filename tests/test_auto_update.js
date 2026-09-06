// test_auto_update.js — the installed-PWA self-update mechanism.
//
// app.js stamps its build via <meta name="app-build"> and, on launch / foreground, re-fetches
// index.html and reloads if that stamp moved (deferring while a field is focused). This needs
// a real HTTP origin (fetch() is dead over file://), so this one test spins up its own tiny
// static server that can change the stamp mid-run to simulate a fresh deploy.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml' };

let buildStamp = 'TEST-BUILD-A'; // mutated below to fake a new deploy

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    let body = buf;
    if (path.basename(file) === 'index.html') {
      body = Buffer.from(buf.toString('utf8').replace(
        /(<meta name="app-build" content=")[^"]*(")/, `$1${buildStamp}$2`), 'utf8');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
});

(async () => {
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
  await page.waitForFunction(() => typeof window._lmCheckForUpdate === 'function');

  const stampOnLoad = await page.evaluate(() => document.querySelector('meta[name="app-build"]').getAttribute('content'));
  console.log('build stamp on first load:', stampOnLoad);
  if (stampOnLoad !== 'TEST-BUILD-A') throw new Error(`expected TEST-BUILD-A, got ${stampOnLoad}`);

  // --- 1. Same stamp -> a check does nothing. ---
  await page.evaluate(() => window._lmCheckForUpdate());
  await page.waitForTimeout(300);
  if (page.isClosed()) throw new Error('page reloaded/closed on a same-stamp check');
  console.log('same-stamp check: no reload (good)');

  // --- 2. Deploy moves on while a field is focused -> reload is DEFERRED. ---
  buildStamp = 'TEST-BUILD-B';
  await page.evaluate(() => switchTab('budget'));
  await page.waitForTimeout(80);
  const activeTag = await page.evaluate(() => {
    const inp = Array.from(document.querySelectorAll('#app input')).find(el => el.offsetParent !== null);
    if (!inp) throw new Error('no visible input on the Budget screen to focus');
    inp.focus();
    return document.activeElement && document.activeElement.tagName;
  });
  if (activeTag !== 'INPUT') throw new Error('failed to focus a Budget input, activeElement=' + activeTag);
  let navigated = false;
  page.once('framenavigated', () => { navigated = true; });
  await page.evaluate(() => window._lmCheckForUpdate());
  await page.waitForTimeout(500);
  if (navigated) throw new Error('reloaded while an input was focused — should have deferred');
  console.log('new stamp while typing: reload deferred (good)');

  // --- 3. Blur the field -> the deferred reload fires, page comes back on BUILD-B. ---
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 5000 }),
    page.evaluate(() => { const el = document.activeElement; if (el) el.blur(); }),
  ]);
  await page.waitForFunction(() => typeof window._lmCheckForUpdate === 'function');
  const stampAfter = await page.evaluate(() => document.querySelector('meta[name="app-build"]').getAttribute('content'));
  console.log('build stamp after deferred reload:', stampAfter);
  if (stampAfter !== 'TEST-BUILD-B') throw new Error(`expected TEST-BUILD-B after reload, got ${stampAfter}`);

  // --- 4. The post-update confirmation toast shows. ---
  const toast = await page.evaluate(() => {
    const t = document.getElementById('toast');
    return { text: t.textContent, shown: t.classList.contains('show') };
  });
  console.log('post-update toast:', toast);
  if (!/updated/i.test(toast.text) || !toast.shown) {
    throw new Error(`expected an "Updated…" toast after the auto-update reload, saw: ${JSON.stringify(toast)}`);
  }

  if (errors.length) throw new Error('Page errors:\n  ' + errors.join('\n  '));
  console.log('test_auto_update.js: PASS');
  await browser.close();
  server.close();
})().catch(e => { console.error(e); server.close(); process.exit(1); });
