// test_css_contract.js — asserts what the cascade actually PRODUCED, not what selectors were written.
//
// CSS has no failure mode for "your rule lost". A bad reference throws, a type error fails tsc,
// a wrong value fails an assertion -- but a declaration that loses on specificity, or a selector
// whose shape never matches, renders a page that merely looks plausible. That is the one part of
// this stack with no feedback channel, and it is why the same family of bug kept recurring:
//
//   1. an element+attribute base (0,1,1) silently beating a bare class (0,1,0)
//   2. a component's layout scoped to one parent, so the class alone got nothing
//   3. a theme rule at (0,2,0) repainting a component's (0,1,0) out from under it
//   4. a descendant selector (`.a .b`) written for classes that sit on the SAME element
//
// getComputedStyle() reports the truth. Every contract here injects a tiny fixture of REAL classes
// into a scratch container, reads the computed result, and runs under EVERY aesthetic -- because
// shape 3 only shows up under the twelve themes that carry structural overrides, and nobody
// switches through twelve themes by hand.
//
// TO ADD A CONTRACT: append one entry to CONTRACTS. `html` is the fixture, `probe` selects the
// element to read within it, then either `prop`+`expect` or an `assert(cs, ctx)` returning null
// for pass or a string saying what's wrong. Failures are collected, not thrown, so one run reports
// every broken contract across every aesthetic instead of the first.
const { chromium } = require('playwright');
const { settle } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

const CONTRACTS = [
  // ---- Shape 1: a bare class must beat the base form styles ----
  // These inject their OWN rule at (0,1,0). If the base ever regains specificity, they fail first.
  { name: 'bare class beats the text-input base (border)',
    css: '.cx-probe { border-color: rgb(1, 2, 3); }',
    html: '<input type="text" class="cx-probe">', probe: 'input',
    prop: 'borderTopColor', expect: 'rgb(1, 2, 3)' },
  { name: 'bare class beats the number-input base (font)',
    css: '.cx-probe { font-family: serif; }',
    html: '<input type="number" class="cx-probe">', probe: 'input',
    prop: 'fontFamily', expect: 'serif' },
  { name: 'bare class beats the textarea base (min-height)',
    css: '.cx-probe { min-height: 7px; }',
    html: '<textarea class="cx-probe"></textarea>', probe: 'textarea',
    prop: 'minHeight', expect: '7px' },
  // Not width: the base's padding floors a select's box above any small width, which reads as a
  // specificity loss and isn't one.
  { name: 'bare class beats the select base (border)',
    css: '.cx-probe { border-color: rgb(1, 2, 3); }',
    html: '<select class="cx-probe"></select>', probe: 'select',
    prop: 'borderTopColor', expect: 'rgb(1, 2, 3)' },

  // ---- Shape 2: .ehead lays itself out, in every context that uses it ----
  // The bare class got nothing for a long time; every parent listed here once had to redeclare
  // flex, and two (.panel) never did and were silently broken.
  ...['', 'entry-card', 'panel', 'panel ex-target', 'phase-card', 'panel skill-item',
      'panel skill-move', 'panel skill-target', 'entry-card reminder-done'].map(ctx => ({
    name: `.ehead is a flex row inside ${ctx ? '.' + ctx.replace(/ /g, '.') : 'nothing at all'}`,
    html: `<div class="${ctx}"><div class="ehead"><span>a</span><span>b</span></div></div>`,
    probe: '.ehead', prop: 'display', expect: 'flex',
  })),
  { name: 'a chip that declares flex:none sits beside the name, not under it (the lifts case)',
    html: '<div class="panel"><div class="ehead"><div>Bench Press</div><span class="lift-muscle-chip">chest</span></div></div>',
    probe: '.ehead',
    assert: (cs, ctx) => {
      const [a, b] = ctx.el.children;
      return b.getBoundingClientRect().top < a.getBoundingClientRect().bottom ? null
        : 'chip rendered on its own line under the name';
    } },

  // ---- Shape 1 again, on the real components that were bitten ----
  { name: 'a pasted lab value wears the accent border',
    html: '<input type="number" class="lab-filled">', probe: 'input',
    assert: (cs, ctx) => cs.borderTopColor === ctx.color('--accent') ? null
      : `border is ${cs.borderTopColor}, accent is ${ctx.color('--accent')}` },
  { name: 'an inline skill-item name is not a boxed input',
    html: '<div class="panel skill-item"><input type="text" class="skill-item-name"></div>', probe: 'input',
    assert: cs => cs.borderTopWidth === '0px' ? null : `has a ${cs.borderTopWidth} top border` },

  // ---- Shape 4: direction colour lands whether the classes are nested or on one element ----
  { name: 'delta chip (classes on parent + child) is coloured toward',
    html: '<div class="lab-delta lab-move-toward"><span class="mono">x</span></div>', probe: '.mono',
    assert: (cs, ctx) => cs.color === ctx.color('--good') ? null : `got ${cs.color}, want ${ctx.color('--good')}` },
  { name: 'history delta (classes on one element) is coloured toward',
    html: '<div class="lab-hist-row"><span class="lab-hist-date">d</span><span class="lab-hist-delta mono lab-move-toward">x</span></div>',
    probe: '.lab-hist-delta',
    assert: (cs, ctx) => cs.color === ctx.color('--good') ? null : `got ${cs.color}, want ${ctx.color('--good')}` },
  { name: 'history delta (classes on one element) is coloured away',
    html: '<div class="lab-hist-row"><span class="lab-hist-delta mono lab-move-away">x</span></div>',
    probe: '.lab-hist-delta',
    assert: (cs, ctx) => cs.color === ctx.color('--bad') ? null : `got ${cs.color}, want ${ctx.color('--bad')}` },

  // A selected chip must not look unselected. COMPARE's picker sets no --tc, and the active
  // fallback used to be --surface2 with hardcoded near-black ink: a selected chip rendered dark
  // text on a dark chip. Contrast is asserted against the UNSELECTED chip rather than a colour,
  // so it holds under every theme's palette.
  { name: 'a selected chip is visibly different from an unselected one',
    html: '<div class="tag-pill-row"><button class="tag-pill">Off</button><button class="tag-pill active">On</button></div>',
    probe: '.tag-pill.active',
    assert: (cs, ctx) => {
      const off = getComputedStyle(ctx.el.previousElementSibling);
      if (cs.backgroundColor === off.backgroundColor) return 'selected and unselected share a background';
      return cs.color === off.color ? 'selected and unselected share a text colour' : null;
    } },
  { name: 'a selected chip\'s label contrasts with its own background',
    html: '<div class="tag-pill-row"><button class="tag-pill active">On</button></div>',
    probe: '.tag-pill.active',
    assert: cs => {
      const lum = s => { const [r, g, b] = (s.match(/[\d.]+/g) || [0, 0, 0]).map(Number); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
      return Math.abs(lum(cs.color) - lum(cs.backgroundColor)) > 0.25 ? null
        : `ink ${cs.color} on ${cs.backgroundColor} is too close to read`;
    } },

  // ---- Shape 3: a component's own signal survives the theme layer ----
  // Aesthetics restate .panel's border at (0,2,0). The rung tint moved to a custom property and a
  // ::before stripe precisely so a theme could repaint the border without erasing the signal.
  { name: 'a reached skill target still carries its rung colour under the theme',
    html: '<div class="panel skill-target skill-target-hit"></div>', probe: '.skill-target',
    assert: cs => cs.getPropertyValue('--rung').trim() ? null : '--rung resolved to nothing' },
  { name: 'the lab bar mark is visible against every theme\'s track',
    html: '<div class="lab-bar"><div class="lab-bar-track"><div class="lab-bar-mark"></div></div></div>',
    probe: '.lab-bar-mark',
    assert: cs => (cs.width !== '0px' && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') ? null
      : `mark is ${cs.width} wide and ${cs.backgroundColor}` },
];

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
  await page.goto(APP_PATH);
  await settle(page);

  const { aesthetics, original } = await page.evaluate(() => ({
    aesthetics: Object.keys(AESTHETICS),
    original: currentAesthetic(),
  }));
  const failures = [];
  let checks = 0;

  for (const aes of aesthetics) {
    // setAesthetic() is the real switch (stylesheet, FX, data attribute, accent) and it re-renders,
    // so the scratch container is (re)created inside each check rather than assumed to survive.
    await page.evaluate(k => setAesthetic(k), aes);
    await settle(page);
    for (const c of CONTRACTS) {
      checks++;
      const result = await page.evaluate(({ css, html, probe, prop, expect, assertSrc }) => {
        // Off-screen but rendered: display:none would zero every measurement.
        let box = document.getElementById('cxScratch');
        if (!box) {
          box = document.createElement('div');
          box.id = 'cxScratch';
          box.style.cssText = 'position:absolute; left:-9999px; top:0; width:360px;';
          document.body.appendChild(box);
        }
        let style = document.getElementById('cxProbeStyle');
        if (!style) {
          style = document.createElement('style');
          style.id = 'cxProbeStyle';
          document.head.appendChild(style);
        }
        style.textContent = css || '';
        box.innerHTML = html;
        const el = box.querySelector(probe);
        if (!el) return 'probe matched nothing';
        const cs = getComputedStyle(el);
        // Resolve a token to the same rgb() form getComputedStyle reports, so colours compare as
        // strings without anyone parsing hex.
        const color = name => {
          const s = document.createElement('span');
          s.style.color = `var(${name})`;
          box.appendChild(s);
          const v = getComputedStyle(s).color;
          s.remove();
          return v;
        };
        if (assertSrc) {
          // eslint-disable-next-line no-new-func
          const fn = new Function('return (' + assertSrc + ')')();
          return fn(cs, { el, color });
        }
        const got = cs[prop];
        return got === expect ? null : `${prop} is ${JSON.stringify(got)}, want ${JSON.stringify(expect)}`;
      }, { css: c.css, html: c.html, probe: c.probe, prop: c.prop, expect: c.expect,
           assertSrc: c.assert ? c.assert.toString() : null });
      if (result) failures.push(`[${aes}] ${c.name}: ${result}`);
    }
  }

  await page.evaluate(k => setAesthetic(k), original);
  await browser.close();

  console.log(`${CONTRACTS.length} contracts x ${aesthetics.length} aesthetics = ${checks} checks, ${failures.length} failed`);
  if (failures.length) {
    // Grouped by contract so a rule broken under all 23 themes reads as one problem, not 23.
    const byName = {};
    failures.forEach(f => { const m = f.match(/^\[([^\]]+)\] (.*?): (.*)$/); (byName[m[2]] = byName[m[2]] || []).push(`${m[1]}: ${m[3]}`); });
    Object.keys(byName).forEach(n => {
      console.log(`\nFAILED: ${n}`);
      byName[n].slice(0, 4).forEach(l => console.log('   ' + l));
      if (byName[n].length > 4) console.log(`   ...and ${byName[n].length - 4} more aesthetics`);
    });
  }
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  if (failures.length) process.exit(1);
  console.log('test_css_contract.js: PASS');
  process.exit(0);
})();
