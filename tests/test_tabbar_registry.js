// test_tabbar_registry.js — the bottom bar is data, and this is that data's contract.
//
// renderTabbar() used to be a ~90-line chain of `if (NAV.currentTab === 'x')` with each section's
// buttons written out by hand. Every navigation change meant editing control flow to express what
// is really a list, and this project has now done three of those. SECTION_BARS makes a section's
// bar a registry entry.
//
// The point of THIS file is that a registry only pays off if a typo in it fails loudly. A
// hand-written bar was at least visible; a data-driven one can name a setter that doesn't exist, an
// icon that doesn't exist, or a subtab the section can't reach, and render a button that looks
// perfectly fine and does nothing. Each of those is checked here, for every section, so the next
// person to move a section finds out at `npm test` rather than on a phone.
//
// What's pinned:
//   1. Every generated onclick calls a function that exists.
//   2. Every icon name resolves — a missing one renders an empty <span>, not an error.
//   3. Every subtab key actually navigates: press it, and the section's NAV key holds it.
//   4. Every alias maps a retired value onto a key that is really on the bar.
//   5. At most one button is active at a time, and a section with subtabs always has exactly one —
//      a bar with nothing lit is the bar and the screen disagreeing about where you are.
//   6. Keys are unique within a section, and Home has no bar at all.
const { chromium } = require('playwright');
const { settle } = require('./helpers');
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
  await page.goto(APP_PATH);
  await settle(page);

  // ---- 1, 2, 4, 6: the registry read as data ----
  const audit = await page.evaluate(() => {
    const out = [];
    Object.keys(SECTION_BARS).forEach(tab => {
      const sec = SECTION_BARS[tab];
      // A function-valued `buttons` can depend on state (hobbies reads NAV.skillId), so it is asked
      // for both answers — a typo hiding in the branch you are not currently on is still a typo.
      const variants = typeof sec.buttons === 'function'
        ? [sec.buttons(), (() => { const s = NAV.skillId; NAV.skillId = 'probe'; const b = sec.buttons(); NAV.skillId = s; return b; })()]
        : [sec.buttons];
      variants.forEach(list => list.forEach(b => {
        out.push({
          tab,
          key: b.key || null,
          icon: b.icon,
          iconResolves: !!(typeof icon === 'function' && icon(b.icon)),
          fn: b.onclick ? b.onclick.replace(/\(.*$/, '') : sec.set,
          fnExists: typeof window[b.onclick ? b.onclick.replace(/\(.*$/, '') : sec.set] === 'function',
          hasLabel: !!(b.label && String(b.label).trim()),
        });
      }));
      // An alias has to land on a key that is actually on this bar, or the retired value lights
      // nothing — which is the exact bug the alias map exists to prevent.
      const keys = (typeof sec.buttons === 'function' ? sec.buttons() : sec.buttons).map(b => b.key).filter(Boolean);
      Object.keys(sec.alias || {}).forEach(from => {
        out.push({ tab, aliasFrom: from, aliasTo: sec.alias[from], aliasValid: keys.includes(sec.alias[from]) });
      });
    });
    return { rows: out, tabs: Object.keys(SECTION_BARS), homeHasBar: !!SECTION_BARS.home };
  });

  const badFn = audit.rows.filter(r => r.fn && !r.fnExists);
  const badIcon = audit.rows.filter(r => r.icon && !r.iconResolves);
  const noLabel = audit.rows.filter(r => r.key !== undefined && r.hasLabel === false);
  const badAlias = audit.rows.filter(r => r.aliasFrom && !r.aliasValid);
  console.log('registry sections:', audit.tabs.join(', '));
  console.log('buttons audited:', audit.rows.filter(r => !r.aliasFrom).length);
  if (badFn.length) throw new Error('These buttons call a function that does not exist: ' + JSON.stringify(badFn));
  if (badIcon.length) throw new Error('These icon names resolve to nothing — the button would render blank: ' + JSON.stringify(badIcon));
  if (noLabel.length) throw new Error('Every button needs a label: ' + JSON.stringify(noLabel));
  if (badAlias.length) throw new Error('These aliases point at a key that is not on that bar: ' + JSON.stringify(badAlias));
  // Home is absent on purpose: its own button moved to the wordmark, and CALENDAR/SETUP moved into
  // the PRODUCTIVITY tile, so the root screen has nothing left of its own.
  if (audit.homeHasBar) throw new Error('Home should have no registry entry — its bar is empty by design');

  // Keys unique within a section: two buttons sharing one would both light at once.
  const dupes = await page.evaluate(() => Object.keys(SECTION_BARS).map(tab => {
    const sec = SECTION_BARS[tab];
    const keys = (typeof sec.buttons === 'function' ? sec.buttons() : sec.buttons).map(b => b.key).filter(Boolean);
    return { tab, dupe: keys.length !== new Set(keys).size };
  }).filter(r => r.dupe));
  if (dupes.length) throw new Error('Duplicate subtab keys: ' + JSON.stringify(dupes));

  // ---- 3. Every key actually navigates ----
  // The failure this catches: a button whose key the section's setter doesn't recognise. It renders,
  // it is tappable, and it silently does nothing.
  const reachable = await page.evaluate(() => {
    const out = [];
    Object.keys(SECTION_BARS).forEach(tab => {
      const sec = SECTION_BARS[tab];
      if (!sec.nav || !sec.set) return;          // action-only bars have nothing to reach
      const before = { tab: NAV.currentTab, sub: NAV[sec.nav] };
      (typeof sec.buttons === 'function' ? sec.buttons() : sec.buttons).forEach(b => {
        if (!b.key) return;
        NAV.currentTab = tab;
        window[sec.set](b.key);
        out.push({ tab, key: b.key, landed: NAV[sec.nav], ok: NAV[sec.nav] === b.key });
      });
      NAV.currentTab = before.tab; NAV[sec.nav] = before.sub;
    });
    return out;
  });
  reachable.forEach(r => console.log(`  ${r.ok ? 'ok ' : 'BAD'} ${r.tab}/${r.key} -> ${r.landed}`));
  const stuck = reachable.filter(r => !r.ok);
  if (stuck.length) throw new Error('These buttons do not reach their own subtab: ' + JSON.stringify(stuck));

  // ...and each key must reach a DIFFERENT screen. The check above is weaker than it looks: the
  // setters just assign, so `setBudgetSubtab('recurrring')` "lands" on its own typo quite happily.
  // What actually goes wrong is downstream — every section's render falls through to a default for
  // an unknown subtab, so a mistyped key renders the FIRST screen while its button lights up. Two
  // keys producing identical markup is that bug, and it is the one a registry makes easiest to
  // introduce (you are editing a string, not a branch).
  const screens = [];
  for (const tab of audit.tabs) {
    const keys = await page.evaluate((t) => {
      const sec = SECTION_BARS[t];
      if (!sec.nav || !sec.set) return [];
      return (typeof sec.buttons === 'function' ? sec.buttons() : sec.buttons).map(b => b.key).filter(Boolean);
    }, tab);
    for (const key of keys) {
      await page.evaluate(([t, k]) => { switchTab(t); window[SECTION_BARS[t].set](k); }, [tab, key]);
      await settle(page);
      const len = await page.evaluate(() => {
        const h = document.getElementById('app').innerHTML;
        // A cheap stable fingerprint — the exact value means nothing, only whether two match.
        let x = 0; for (let i = 0; i < h.length; i++) { x = (x * 31 + h.charCodeAt(i)) | 0; }
        return { hash: x, empty: h.trim().length < 40 };
      });
      screens.push({ tab, key, ...len });
    }
  }
  screens.forEach(s => console.log(`  ${s.tab}/${s.key} screen ${s.hash}`));
  const blank = screens.filter(s => s.empty);
  if (blank.length) throw new Error('These subtabs render nothing at all: ' + JSON.stringify(blank.map(s => s.tab + '/' + s.key)));
  audit.tabs.forEach(tab => {
    const mine = screens.filter(s => s.tab === tab);
    const seen = new Map();
    mine.forEach(s => { const prev = seen.get(s.hash); if (prev) {
      throw new Error(`${tab}: "${prev}" and "${s.key}" render the IDENTICAL screen — one of them is not a real subtab, so its button lights up and shows the other's content`);
    } seen.set(s.hash, s.key); });
  });

  // ---- 5. Exactly one active, including from a retired value ----
  const active = await page.evaluate(() => {
    const count = html => (html.match(/class="[^"]*\bactive\b/g) || []).length;
    const out = {};
    Object.keys(SECTION_BARS).forEach(tab => {
      const sec = SECTION_BARS[tab];
      NAV.currentTab = tab;
      out[tab] = { hasSubtabs: !!sec.nav, lit: count(renderTabbar()) };
      // Every retired value the alias map knows about must still light its successor.
      Object.keys(sec.alias || {}).forEach(from => {
        const keep = NAV[sec.nav];
        NAV[sec.nav] = from;
        out[tab + ' via ' + from] = { hasSubtabs: true, lit: count(renderTabbar()) };
        NAV[sec.nav] = keep;
      });
    });
    NAV.currentTab = 'home';
    return out;
  });
  Object.entries(active).forEach(([k, v]) => console.log(`  ${k}: ${v.lit} lit`));
  Object.entries(active).forEach(([k, v]) => {
    if (v.lit > 1) throw new Error(`${k} lights ${v.lit} buttons at once — only one place can be where you are`);
    if (v.hasSubtabs && v.lit !== 1) {
      throw new Error(`${k} lights nothing: the bar and the screen would disagree about where you are`);
    }
  });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_tabbar_registry.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_tabbar_registry.js: FAIL\n' + e.message); process.exit(1); });
