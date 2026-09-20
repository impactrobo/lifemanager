// test_panel_ring.js — a panel's padding must clear the edge it paints INSIDE itself.
//
// Reported 2026-09-19 from the phone, on Hedge: "the scheduled item is hanging outside the bounds
// of the container". Home's day pane, at 9:50pm, with the NOW card as the last row.
//
// Nothing was wrong with the layout. `getBoundingClientRect()` put every row comfortably inside the
// panel — the first investigation measured exactly that and found 14px of clearance, which is why
// this looked like a non-bug twice over. The trap is that eight aesthetics draw a `.panel`'s edge
// as an INSET box-shadow rather than a `border`:
//
//   [data-aesthetic="hedge"] .panel { border: none; box-shadow: var(--hg-edge); }
//   --hg-edge: inset 0 0 0 2px ..., inset 0 0 0 5px ..., inset 0 0 0 7px ...;
//
// An inset shadow is PAINTED, not laid out. It occupies no space and the box model knows nothing
// about it, so a panel can legally pad less than its own visible edge. The day pane padded 2px
// vertically; hedge rings 7px; millennium rings 9px. The NOW card — the one row with a background
// of its own — therefore sat up to 7px INSIDE the ring and painted straight over it.
//
// What's pinned, across every aesthetic:
//   1. The deepest ring any aesthetic paints has not outgrown --panel-ring in styles.css. That
//      constant is what every tightened panel is measured against, and a new aesthetic ringing
//      deeper would silently invalidate it.
//   2. On Home's day pane, the NOW card clears the ring on all four sides. This is the report.
//
// The ring depth is re-derived from the live computed style rather than restated here: the whole
// bug was a number in one file (padding) being checked against a number in another (the ring) by
// nobody.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');
// 21:50 on a Saturday: eleven anchors behind you, Bed running, nothing after it — so the NOW card
// is the LAST row in the pane and sits against the bottom edge. That is the reported condition;
// at midday the card has rows below it and the collision is invisible.
const REPORTED_MOMENT = '2026-09-19T21:50:00';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page, REPORTED_MOMENT);
  await page.goto(APP_PATH);
  await settle(page);

  await page.evaluate(() => {
    // Computed box-shadow serialises its colours with their own commas and parens, so a naive
    // split on "," tears one shadow into several. Depth-aware split instead.
    window.__deepestInset = (s) => {
      const parts = []; let depth = 0, cur = '';
      for (const ch of (s || '')) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      if (cur.trim()) parts.push(cur);
      let deepest = 0;
      for (const part of parts) {
        if (!/\binset\b/.test(part)) continue;
        const nums = (part.match(/-?[\d.]+px/g) || []).map(parseFloat);
        const spread = nums.length >= 4 ? nums[3] : 0;   // offset-x, offset-y, blur, SPREAD
        if (spread > deepest) deepest = spread;
      }
      return deepest;
    };
  });

  const declared = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-ring')));
  if (!isFinite(declared) || declared <= 0) {
    throw new Error('--panel-ring is not declared in styles.css (got ' + declared + ')');
  }

  const keys = await page.evaluate(() => Object.keys(AESTHETICS));
  const ringed = [];
  const crossing = [];
  let deepest = 0;

  for (const key of keys) {
    await page.evaluate((a) => { setAesthetic(a); saveState(); }, key);
    await settle(page);
    // Several aesthetics load aesthetics/<key>/theme.css lazily; measuring before it lands reads
    // the UNRINGED default and passes a broken build. Wait for the sheet, not a guess.
    await page.waitForFunction((a) => {
      if (!(AESTHETICS[a] || {}).external) return true;
      const link = [...document.querySelectorAll('link[rel="stylesheet"]')]
        .find(l => l.href.includes('/' + a + '/'));
      return !!(link && link.sheet);
    }, key, { timeout: 5000 });
    await settle(page);

    const m = await page.evaluate(() => {
      const panel = [...document.querySelectorAll('#app .panel')].find(el => el.querySelector('.day-head'));
      if (!panel) return null;
      const cs = getComputedStyle(panel);
      const now = panel.querySelector('.day-row-now');
      if (!now) return null;
      const nowBg = getComputedStyle(now).backgroundColor;
      const pr = panel.getBoundingClientRect(), nr = now.getBoundingClientRect();
      return {
        ring: window.__deepestInset(cs.boxShadow),
        paintsOwnBg: !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(nowBg),
        top: Math.round(nr.top - pr.top),
        bottom: Math.round(pr.bottom - nr.bottom),
        left: Math.round(nr.left - pr.left),
        right: Math.round(pr.right - nr.right),
      };
    });
    if (!m) throw new Error(`no day pane with a NOW card rendered in "${key}" — the fixture broke`);
    // If the NOW row ever stops painting its own background this test proves nothing, so say so
    // rather than passing vacuously.
    if (!m.paintsOwnBg) throw new Error(`the NOW card has no background of its own in "${key}"`);

    if (m.ring > deepest) deepest = m.ring;
    if (m.ring > 0) ringed.push(key);
    const worst = Math.min(m.top, m.bottom, m.left, m.right);
    if (m.ring > worst) {
      crossing.push({ key, ring: m.ring, clearance: worst, crossesBy: m.ring - worst, sides: m });
    }
  }

  // ---- 1. The declared constant still covers the deepest ring ----
  console.log(`1. ${ringed.length}/${keys.length} aesthetics ring their panels; deepest ${deepest}px, --panel-ring ${declared}px`);
  if (deepest > declared) {
    throw new Error(
      `an aesthetic now rings ${deepest}px deep but --panel-ring is ${declared}px — every panel ` +
      `that tightens its padding is measured against that constant, so raise it in styles.css`);
  }

  // ---- 2. The reported case: the NOW card clears the ring everywhere ----
  if (crossing.length) {
    throw new Error(
      'the NOW card paints over the panel\'s own edge in: ' +
      crossing.map(c => `${c.key} (ring ${c.ring}px, only ${c.clearance}px clear — crosses by ${c.crossesBy}px)`).join('; ') +
      '\nThis is the reported bug: "the scheduled item is hanging outside the bounds of the container".');
  }
  console.log(`2. the NOW card clears the painted edge in all ${keys.length} aesthetics`);

  await page.evaluate(() => { setAesthetic('cyberpunk'); saveState(); });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_panel_ring.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_panel_ring.js: FAIL\n' + e.message); process.exit(1); });
