// test_aesthetic_external.js — the lazily-loaded ("external") aesthetic mechanism.
//
// Maximalist aesthetics keep their CSS in aesthetics/<key>/theme.css instead of styles.css,
// loaded on demand into the single <link id="aestheticCss"> slot. This asserts the slot is
// wired both ways (points at the theme when one is active, cleared when a built-in is), that
// the external file's tokens actually land, and that it defines the full required token set.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const APP_PATH = 'file://' + path.join(ROOT, 'index.html');
// Comments stripped so a selector merely *mentioned* in a explanatory comment doesn't count.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const baseCss = stripComments(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'));
const themeCssFor = (key) => stripComments(fs.readFileSync(path.join(ROOT, 'aesthetics', key, 'theme.css'), 'utf8'));

// Every aesthetic must define all of these — same contract as the inline ones.
const REQUIRED_TOKENS = [
  '--bg', '--surface', '--surface2', '--border', '--border-soft',
  '--text', '--text-dim', '--text-faint',
  '--accent', '--accent-dim', '--accent-soft',
  '--good', '--good-soft', '--bad', '--bad-soft', '--warn',
  '--reset-border', '--reset-bg', '--reset-text',
  '--myo', '--goldenrod', '--savings', '--savings-soft',
  '--font-head', '--font-body', '--font-mono', '--radius',
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    return route.abort(); // blocks the theme's Google Fonts @import — expected, see README
  });

  await page.goto(APP_PATH);
  await page.waitForTimeout(300);

  // The slot exists and starts empty (default aesthetic is a built-in one).
  const slotStart = await page.evaluate(() => {
    const l = document.getElementById('aestheticCss');
    return { exists: !!l, href: l && l.getAttribute('href') };
  });
  console.log('#aestheticCss on load:', slotStart);
  if (!slotStart.exists) throw new Error('<link id="aestheticCss"> missing from index.html');
  if (slotStart.href) throw new Error(`expected empty href for a built-in aesthetic, got '${slotStart.href}'`);

  // Every aesthetic flagged external must have a matching registry entry + accents.
  const externals = await page.evaluate(() =>
    Object.entries(AESTHETICS).filter(([, v]) => v.external).map(([k]) => k));
  console.log('external aesthetics:', externals);
  if (externals.length === 0) throw new Error('no external aesthetics registered — this test has nothing to cover');

  for (const key of externals) {
    await page.evaluate(k => setAesthetic(k), key);
    await page.waitForTimeout(250); // let the stylesheet fetch + apply

    const href = await page.evaluate(() => document.getElementById('aestheticCss').getAttribute('href'));
    if (href !== `aesthetics/${key}/theme.css`) {
      throw new Error(`expected href 'aesthetics/${key}/theme.css' for '${key}', got '${href}'`);
    }

    // The external file actually loaded and its rules won: check the full token set resolves.
    const missing = await page.evaluate((tokens) => {
      const cs = getComputedStyle(document.documentElement);
      return tokens.filter(t => !cs.getPropertyValue(t).trim());
    }, REQUIRED_TOKENS);
    if (missing.length) throw new Error(`external aesthetic '${key}' missing tokens: ${missing.join(', ')}`);

    // Sanity: a token whose value can only have come from the external file.
    const radius = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--radius').trim());
    console.log(`  ${key}: href ok, all ${REQUIRED_TOKENS.length} tokens present, --radius=${radius}`);
    if (!radius) throw new Error(`'${key}' did not apply --radius — theme.css may not have loaded`);

    // The picker swatch must be styled from styles.css, not the theme file, since the picker
    // renders while another aesthetic is active (so theme.css isn't loaded). Checked against
    // the file on disk — Chromium won't expose cssRules for a file:// stylesheet.
    if (!baseCss.includes(`.aesthetic-preview-${key}`)) {
      throw new Error(`.aesthetic-preview-${key} is not in styles.css — the picker swatch would be unstyled from other themes`);
    }
    if (themeCssFor(key).includes(`.aesthetic-preview-${key}`)) {
      throw new Error(`.aesthetic-preview-${key} is in the lazily-loaded theme.css — move it to styles.css`);
    }
  }

  // Switching back to a built-in clears the slot again (no stale theme bleeding through).
  await page.evaluate(() => setAesthetic('cyberpunk'));
  await page.waitForTimeout(150);
  const slotEnd = await page.evaluate(() => document.getElementById('aestheticCss').getAttribute('href'));
  console.log('#aestheticCss after switching back to a built-in:', slotEnd);
  if (slotEnd) throw new Error(`expected href cleared for built-in aesthetic, got '${slotEnd}'`);

  // ...and the built-in's own tokens are back in charge.
  const backToBuiltin = await page.evaluate(() => ({
    aesthetic: document.documentElement.dataset.aesthetic,
    radius: getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(),
  }));
  console.log('after revert:', backToBuiltin);
  if (backToBuiltin.aesthetic !== 'cyberpunk') throw new Error('data-aesthetic did not revert');

  // The choice survives a reload (external CSS re-loads on boot, not just on click).
  await page.evaluate(() => setAesthetic('frutigeraero'));
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForTimeout(350);
  const afterReload = await page.evaluate(() => ({
    href: document.getElementById('aestheticCss').getAttribute('href'),
    aesthetic: document.documentElement.dataset.aesthetic,
  }));
  console.log('after reload with an external aesthetic saved:', afterReload);
  if (afterReload.aesthetic !== 'frutigeraero') throw new Error('external aesthetic did not persist across reload');
  if (afterReload.href !== 'aesthetics/frutigeraero/theme.css') {
    throw new Error(`stylesheet slot not restored on boot, got '${afterReload.href}'`);
  }

  if (errors.length) throw new Error('Page errors:\n  ' + errors.join('\n  '));
  console.log('test_aesthetic_external.js: PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
