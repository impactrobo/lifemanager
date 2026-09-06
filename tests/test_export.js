// test_export.js — exportData()'s real download path (Blob + <a download>, verified via a
// captured Playwright download event) and importData()'s file-based restore + malformed-file
// handling.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
  await page.waitForTimeout(300);

  // 1. exportData() with no window.claude and no Web Share API (typical desktop-browser
  //    situation on plain hosting like GitHub Pages): should fall through to the Blob + <a
  //    download> path and trigger a real, capturable download.
  const hasClaudeRuntime = await page.evaluate(() => typeof window.claude !== 'undefined');
  const hasShareApi = await page.evaluate(() => typeof navigator.share === 'function');
  console.log('window.claude present:', hasClaudeRuntime, '| navigator.share present:', hasShareApi);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.evaluate(() => exportData()),
  ]);
  const suggestedName = download.suggestedFilename();
  console.log('download triggered, suggested filename:', suggestedName);
  if (!/^lifeman-backup-.*\.json$/.test(suggestedName)) {
    throw new Error(`Expected a filename like "lifeman-backup-YYYY-MM-DD.json", got "${suggestedName}"`);
  }
  const downloadPath = await download.path();
  const downloadedContent = fs.readFileSync(downloadPath, 'utf8');
  const parsedDownload = JSON.parse(downloadedContent);
  console.log('downloaded file is valid JSON with', Object.keys(parsedDownload).length, 'top-level keys');
  if (!parsedDownload.settings) throw new Error('Expected the downloaded backup JSON to contain a "settings" key (i.e. be a real STATE dump)');
  const toastText = await page.evaluate(() => document.getElementById('toast').textContent);
  console.log('toast after successful export:', toastText);
  if (toastText !== 'Backup downloaded') throw new Error(`Expected "Backup downloaded" toast, got "${toastText}"`);
  if (errors.length > 0) throw new Error('exportData() threw a page error: ' + errors.join('; '));

  // 2. importData(): build a sample backup file with a distinctive marker, load it via the
  //    real file input, confirm STATE gets replaced/merged with it.
  const sampleState = {
    notes: [{ id: 'import-test-note', date: '2026-01-01', createdAt: 1, title: 'Imported', bodyHtml: 'x', tag: 'general', photos: [] }],
    _importTestMarker: 'marker-' + Date.now(),
  };
  const tmpFile = path.join(os.tmpdir(), 'test-import-backup.json');
  fs.writeFileSync(tmpFile, JSON.stringify(sampleState));

  await page.evaluate(() => { switchTab('home'); openSetup('home'); });
  await page.waitForTimeout(150);
  await page.setInputFiles('#importFile', tmpFile);
  await page.waitForTimeout(300);

  const marker = await page.evaluate(() => STATE._importTestMarker);
  const importedNote = await page.evaluate(() => (STATE.notes || []).find(n => n.id === 'import-test-note'));
  console.log('STATE._importTestMarker after import:', marker);
  console.log('imported note present:', !!importedNote);
  if (marker !== sampleState._importTestMarker) throw new Error('Expected importData() to merge the uploaded JSON into STATE');
  if (!importedNote) throw new Error('Expected the imported note to be present in STATE.notes');

  // 3. Confirms it went through defaultState() merge (not a raw overwrite) — settings should
  //    still exist even though our sample file didn't include a settings key at all.
  const hasSettings = await page.evaluate(() => typeof STATE.settings === 'object' && STATE.settings !== null);
  console.log('STATE.settings still present after importing a file with no settings key:', hasSettings);
  if (!hasSettings) throw new Error('Expected importData() to fall back to defaultState() for keys missing from the imported file');

  // 4. Malformed JSON should fail safely: show the error toast, not throw, and not wipe STATE.
  const beforeBadImport = await page.evaluate(() => STATE._importTestMarker);
  const badFile = path.join(os.tmpdir(), 'test-import-bad.json');
  fs.writeFileSync(badFile, '{ this is not valid json');
  await page.setInputFiles('#importFile', badFile);
  await page.waitForTimeout(300);
  const afterBadImport = await page.evaluate(() => STATE._importTestMarker);
  const badToast = await page.evaluate(() => document.getElementById('toast').textContent);
  console.log('toast after malformed-JSON import:', badToast);
  console.log('STATE marker before/after bad import (should be unchanged):', beforeBadImport, '/', afterBadImport);
  if (badToast !== 'Could not read that file') throw new Error(`Expected the "could not read" toast, got "${badToast}"`);
  if (afterBadImport !== beforeBadImport) throw new Error('Expected a malformed import to leave existing STATE untouched');

  fs.unlinkSync(tmpFile);
  fs.unlinkSync(badFile);
  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_export.js: PASS');
  process.exit(0);
})();
