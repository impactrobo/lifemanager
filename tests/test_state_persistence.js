// test_state_persistence.js — the loadState() migration contract.
//
// ARCHITECTURE.md's #1 footgun: a new top-level STATE field must be added to BOTH
// defaultState() AND the field-by-field merge in loadState(), or existing users load with it
// missing. This asserts (1) a stored save loads back intact and (2) an old save missing newer
// fields gains the current defaults without losing its existing data.
const { chromium } = require('playwright');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');
const STORAGE_KEY = 'ironlog_state_v1';

async function boot(seedState) {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    return route.abort();
  });
  await page.addInitScript(([k, s]) => {
    try { localStorage.setItem(k, JSON.stringify(s)); } catch (e) {}
  }, [STORAGE_KEY, seedState]);
  await page.goto(APP_PATH);
  await page.waitForTimeout(300);
  return { browser, page, errors };
}

(async () => {
  // 1. Round-trip: what we seed is what the app loads.
  {
    const { browser, page, errors } = await boot({
      units: 'kg',
      settings: { aesthetic: 'honey' },
      diet: { tdee: 2222 },
    });
    const got = await page.evaluate(() => ({
      units: STATE.units, aesthetic: STATE.settings.aesthetic, tdee: STATE.diet.tdee,
    }));
    console.log('seeded save loaded back as:', got);
    if (got.units !== 'kg') throw new Error('seeded units not applied');
    if (got.aesthetic !== 'honey') throw new Error('seeded aesthetic not applied');
    if (got.tdee !== 2222) throw new Error('seeded diet.tdee not applied');
    if (errors.length) throw new Error('Page errors:\n  ' + errors.join('\n  '));
    await browser.close();
  }

  // 2. Migration: a minimal "old" save gains current defaults, keeps its own data.
  {
    const { browser, page, errors } = await boot({
      units: 'lb',
      weightLog: [{ id: 'x1', date: '2024-01-01', weightLb: 180 }],
      settings: { aesthetic: 'cyberpunk' },
    });
    const r = await page.evaluate(() => {
      const s = STATE, d = defaultState();
      return {
        hasCloudSync: !!(s.settings && s.settings.cloudSync),
        hasSavingsPlan: !!(s.budget && s.budget.savingsPlan),
        keptWeightLog: Array.isArray(s.weightLog) && s.weightLog.length === 1 && s.weightLog[0].weightLb === 180,
        missingKeys: Object.keys(d).filter(k => !(k in s)),
      };
    });
    console.log('after migrating a minimal old save:', r);
    if (!r.hasCloudSync) throw new Error('settings.cloudSync not filled from defaults');
    if (!r.hasSavingsPlan) throw new Error('budget.savingsPlan not filled from defaults');
    if (!r.keptWeightLog) throw new Error('seeded legacy weightLog was lost in the merge');
    if (r.missingKeys.length) {
      throw new Error('loaded STATE is missing default keys (add them to the loadState() merge): ' + r.missingKeys.join(', '));
    }
    if (errors.length) throw new Error('Page errors:\n  ' + errors.join('\n  '));
    await browser.close();
  }

  console.log('test_state_persistence.js: PASS');
})().catch(e => { console.error(e); process.exit(1); });
