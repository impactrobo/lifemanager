// test_home.js — Home screen: section tiles render, edit mode toggles (highlighting the edit
// button, and disabling a box's own click-to-navigate/act behavior while its hide button stays
// clickable), hide/show a section, and the layout choice survives a reload (persisted via
// STATE.settings.homeLayout).
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

  // This test needs one clickable, non-edit control inside a Home box (see 2c/2e below) that is
  // there regardless of when the test runs. It used to clear the anchors so RIGHT NOW would fall
  // back to its clock-independent "FREE TIME" card. The day box that replaced RIGHT NOW needs the
  // opposite: it renders nothing at all with no anchors, no plan and no habits, so the default
  // anchors are left in place — and its OPEN CALENDAR button doesn't depend on the clock the way
  // the timeline's own contents do.

  // 1. Home tiles render on load
  const tileCount = await page.$$eval('.home-tile', els => els.length);
  console.log('home tiles on load:', tileCount);
  if (tileCount === 0) throw new Error('Expected at least one .home-tile on Home, found 0');

  // 2. Edit mode toggles and shows per-tile hide ("x") buttons
  await page.click('#homeEditBtn');
  await settle(page);
  const editMode = await page.evaluate(() => UI.homeEditMode === true);
  console.log('UI.homeEditMode after toggle:', editMode);
  if (!editMode) throw new Error('Expected UI.homeEditMode to be true after clicking #homeEditBtn');

  const hideButtons = await page.$$eval('.home-edit-x', els => els.length);
  console.log('hide (x) buttons visible in edit mode:', hideButtons);
  if (hideButtons === 0) throw new Error('Expected .home-edit-x buttons while UI.homeEditMode is true');

  // 2b. The edit button itself is highlighted while edit mode is active. Checks the *computed*
  // border color against a live-rendered var(--warn) probe, not just class presence — a class can
  // be attached while a same-specificity, later-in-file rule (.icon-btn) silently overrides its
  // styling, which is exactly the bug this once shipped as (see styles.css's
  // .icon-btn.home-edit-toggle-active comment). A plain classList check would never have caught it.
  const hasClass = await page.evaluate(() => document.getElementById('homeEditBtn').classList.contains('home-edit-toggle-active'));
  if (!hasClass) throw new Error('Expected #homeEditBtn to carry .home-edit-toggle-active while UI.homeEditMode is true');
  // The border ANIMATES: styles.css gives .icon-btn a 150ms border-color transition (for hover), so
  // an immediate computed-style read lands mid-transition and reports an in-between colour. This
  // used to pass only because the old waitForTimeout(150) happened to equal the transition -- a
  // real-timer wait disguised as a render wait. Wait for the actual condition instead of a sleep
  // that matches a duration: if the cascade bug ever returns, this times out with a clear message
  // rather than passing vacuously.
  const borderVsWarn = () => {
    const probe = document.createElement('span'); probe.style.color = 'var(--warn)'; document.body.appendChild(probe);
    const warn = getComputedStyle(probe).color; probe.remove();
    return { border: getComputedStyle(document.getElementById('homeEditBtn')).borderColor, warn };
  };
  try {
    await page.waitForFunction(() => {
      const probe = document.createElement('span'); probe.style.color = 'var(--warn)'; document.body.appendChild(probe);
      const warn = getComputedStyle(probe).color; probe.remove();
      return getComputedStyle(document.getElementById('homeEditBtn')).borderColor === warn;
    }, null, { timeout: 2000 });
  } catch (e) {
    const got = await page.evaluate(borderVsWarn);
    throw new Error(`Expected #homeEditBtn's border to resolve to --warn (${got.warn}) while active -- waited 2s for the 150ms transition and it never did, got ${got.border}`);
  }
  console.log('#homeEditBtn while active: class present, border settled to --warn');

  // 2c. Tapping into a box's own content must NOT navigate away while in edit mode — it's easy to
  // accidentally tap a box while trying to drag-reorder it. A real click (not calling the handler
  // directly), since this exercises the capturing listener that intercepts it. The target used to
  // be RIGHT NOW's "FREE TIME, tap to view" panel; that box folded into the day box, whose
  // OPEN CALENDAR button is the equivalent way out of Home.
  const dayBoxLink = await page.$('.home-edit-box [onclick*="goHomeSection"]');
  if (!dayBoxLink) throw new Error("Expected the day box to offer a way through to Schedule (fresh state has the 12 default anchors, so the day box renders)");
  await dayBoxLink.click();
  await settle(page);
  const tabAfterEditClick = await page.evaluate(() => NAV.currentTab);
  console.log("NAV.currentTab after tapping the day box's link while in edit mode:", tabAfterEditClick);
  if (tabAfterEditClick !== 'home') throw new Error(`Expected tapping a box in edit mode to stay on Home, but NAV.currentTab became "${tabAfterEditClick}"`);

  // 2d. ...but the box's own hide (X) button must still work — a real click, not calling
  // hideHomeBox() directly, to prove the capturing listener's exclusion actually applies in the DOM.
  const boxIdsBefore = await page.evaluate(() => STATE.settings.homeLayout.boxOrder.slice());
  const boxHideBtn = await page.$('.home-edit-box .home-edit-x');
  if (!boxHideBtn) throw new Error('Expected at least one box to have a visible hide (X) button');
  await boxHideBtn.click();
  await settle(page);
  const boxIdsAfter = await page.evaluate(() => STATE.settings.homeLayout.boxOrder);
  console.log('box hide (X) click actually hid one:', boxIdsAfter.length === boxIdsBefore.length - 1);
  if (boxIdsAfter.length !== boxIdsBefore.length - 1) throw new Error(`Expected clicking a box's (X) to remove exactly one box, went ${boxIdsBefore.length} -> ${boxIdsAfter.length}`);
  const hiddenBoxId = boxIdsBefore.find(id => !boxIdsAfter.includes(id));
  await page.evaluate((id) => showHomeBox(id), hiddenBoxId); // restore it for the rest of the test

  // 2e. Leaving edit mode restores normal tap-to-navigate behavior on the same control
  await page.click('#homeEditBtn'); // toggle edit mode back off
  await settle(page);
  const editModeOff = await page.evaluate(() => UI.homeEditMode === false);
  if (!editModeOff) throw new Error('Expected UI.homeEditMode to be false after toggling #homeEditBtn a second time');
  const dayBoxLinkAgain = await page.$('[onclick*="goHomeSection(\'schedule\')"]');
  if (!dayBoxLinkAgain) throw new Error("Expected the day box's link through to Schedule to still be present outside edit mode");
  await dayBoxLinkAgain.click();
  await settle(page);
  const tabAfterNormalClick = await page.evaluate(() => NAV.currentTab);
  console.log('NAV.currentTab after tapping the same control outside edit mode:', tabAfterNormalClick);
  if (tabAfterNormalClick !== 'schedule') throw new Error(`Expected normal (non-edit-mode) tap to navigate to Schedule, got NAV.currentTab="${tabAfterNormalClick}"`);
  await page.evaluate(() => { switchTab('home'); toggleHomeEditMode(); }); // back to Home, back into edit mode for the rest of the test

  // 3. Hide the first section, confirm tile count drops by 1 and it persists to STATE
  const beforeIds = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder.slice());
  const targetId = beforeIds[0];
  await page.evaluate((id) => hideHomeSection(id), targetId);
  await settle(page);

  const afterOrder = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder);
  const afterHidden = await page.evaluate(() => STATE.settings.homeLayout.sectionHidden);
  console.log('sectionOrder after hide:', afterOrder, '| sectionHidden:', afterHidden);
  if (afterOrder.includes(targetId)) throw new Error(`Expected '${targetId}' removed from sectionOrder after hideHomeSection`);
  if (!afterHidden.includes(targetId)) throw new Error(`Expected '${targetId}' present in sectionHidden after hideHomeSection`);

  // 4. Reload the page (simulating app relaunch) and confirm the hide persisted via localStorage
  await page.reload();
  await settle(page);
  const persistedHidden = await page.evaluate(() => STATE.settings.homeLayout.sectionHidden);
  console.log('sectionHidden after reload:', persistedHidden);
  if (!persistedHidden.includes(targetId)) throw new Error('Expected hidden section to survive a reload (persisted to localStorage)');

  // 5. Show it back (cleanup) and confirm it returns
  await page.evaluate((id) => showHomeSection(id), targetId);
  await settle(page);
  const restoredOrder = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder);
  if (!restoredOrder.includes(targetId)) throw new Error(`Expected '${targetId}' restored to sectionOrder after showHomeSection`);

  // 6. Each of the 6 section tiles gets its own fixed color (not shared/generic) as a vignette on
  // the tile's own background (homeTileGlowStyle()) — checked via the raw `style` attribute text
  // (unnormalized), since the color is embedded inside a radial-gradient() string rather than
  // being its own recognized CSS property browsers would normalize on read-back.
  await page.evaluate(() => { switchTab('home'); });
  await settle(page);
  const tileColors = await page.evaluate(() => {
    const ids = STATE.settings.homeLayout.sectionOrder;
    return ids.map(id => {
      const tile = [...document.querySelectorAll('.home-tile')].find(t => t.textContent.includes(HOME_SECTION_META[id].label));
      return { id, expected: HOME_SECTION_META[id].color, tileStyle: tile ? tile.getAttribute('style') : null };
    });
  });
  console.log('tile vignette colors:', tileColors);
  const uniqueColors = new Set(tileColors.map(t => t.expected));
  if (uniqueColors.size !== 6) throw new Error(`Expected all 6 sections to have distinct colors, got ${uniqueColors.size} unique: ${JSON.stringify([...uniqueColors])}`);
  for (const t of tileColors) {
    if (!t.tileStyle || !t.tileStyle.includes(t.expected)) throw new Error(`Expected tile "${t.id}" to embed its color ${t.expected}, got style="${t.tileStyle}"`);
  }

  // 7. The color follows the section id through a reorder, not the position — drag "budget" to
  // the front and confirm its vignette is still its own, not whatever "schedule" (the old first
  // tile) used to have.
  await page.evaluate(() => reorderHomeList('sections', 'budget', 'schedule')); // move budget to sit before schedule
  await settle(page);
  const budgetStyleAfter = await page.evaluate(() => {
    const tile = [...document.querySelectorAll('.home-tile')].find(t => t.textContent.includes(HOME_SECTION_META.budget.label));
    return tile ? tile.getAttribute('style') : null;
  });
  console.log('budget tile style after reordering to the front:', budgetStyleAfter);
  const budgetColor = tileColors.find(t => t.id === 'budget').expected;
  const scheduleColor = tileColors.find(t => t.id === 'schedule').expected;
  if (!budgetStyleAfter || !budgetStyleAfter.includes(budgetColor)) throw new Error(`Expected budget's tile to keep its own color ${budgetColor} after moving to the front, got "${budgetStyleAfter}"`);
  if (budgetStyleAfter.includes(scheduleColor)) throw new Error('Expected budget\'s tile to NOT pick up schedule\'s old position color');

  // 8. reorderHomeList()'s insertAfter fix: dropping "before" a target could never actually land
  // an item in the true last slot (nothing exists after the last item to drop "before" into) —
  // insertAfter=true on the current last item is what onHomeDragMove() now sends when the pointer
  // is past that item's far edge, and it must actually produce the real last position.
  await page.evaluate(() => { STATE.settings.homeLayout = defaultHomeLayout(); saveState(); });
  const orderBefore = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder.slice());
  const firstId = orderBefore[0], lastId = orderBefore[orderBefore.length - 1];
  await page.evaluate((args) => reorderHomeList('sections', args.firstId, args.lastId, true), { firstId, lastId });
  const orderAfterInsertAfter = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder);
  console.log('order before/after moving the first item onto the last with insertAfter=true:', orderBefore, '/', orderAfterInsertAfter);
  if (orderAfterInsertAfter[orderAfterInsertAfter.length - 1] !== firstId) {
    throw new Error(`Expected "${firstId}" to land in the true last slot, got order ${JSON.stringify(orderAfterInsertAfter)}`);
  }
  if (orderAfterInsertAfter[orderAfterInsertAfter.length - 2] !== lastId) {
    throw new Error(`Expected the old last item "${lastId}" to now sit second-to-last, got order ${JSON.stringify(orderAfterInsertAfter)}`);
  }

  // insertAfter=false (or omitted) on the same drop still inserts *before* the target, unaffected
  // — confirms the fix is additive, not a change to the existing default behavior.
  await page.evaluate(() => { STATE.settings.homeLayout = defaultHomeLayout(); saveState(); });
  await page.evaluate((args) => reorderHomeList('sections', args.firstId, args.lastId), { firstId, lastId });
  const orderAfterBefore = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder);
  console.log('order after the same move without insertAfter:', orderAfterBefore);
  if (orderAfterBefore[orderAfterBefore.length - 1] !== lastId) {
    throw new Error(`Expected the target to remain last when insertAfter is unset, got order ${JSON.stringify(orderAfterBefore)}`);
  }
  if (orderAfterBefore[orderAfterBefore.length - 2] !== firstId) {
    throw new Error(`Expected the dragged item to sit immediately before the target, got order ${JSON.stringify(orderAfterBefore)}`);
  }

  // cleanup — restore the default section order this test's reordering disturbed
  await page.evaluate(() => {
    STATE.settings.homeLayout = defaultHomeLayout();
    saveState();
  });

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_home.js: PASS');
  process.exit(0);
})();
