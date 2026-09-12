// test_home.js — Home screen: section tiles render, edit mode toggles (highlighting the edit
// button, and disabling a box's own click-to-navigate/act behavior while its hide button stays
// clickable), hide/show a section, and the layout choice survives a reload (persisted via
// STATE.settings.homeLayout).
const { chromium } = require('playwright');
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
  await page.waitForTimeout(300);

  // 1. Home tiles render on load
  const tileCount = await page.$$eval('.home-tile', els => els.length);
  console.log('home tiles on load:', tileCount);
  if (tileCount === 0) throw new Error('Expected at least one .home-tile on Home, found 0');

  // 2. Edit mode toggles and shows per-tile hide ("x") buttons
  await page.click('#homeEditBtn');
  await page.waitForTimeout(150);
  const editMode = await page.evaluate(() => HOME_EDIT_MODE === true);
  console.log('HOME_EDIT_MODE after toggle:', editMode);
  if (!editMode) throw new Error('Expected HOME_EDIT_MODE to be true after clicking #homeEditBtn');

  const hideButtons = await page.$$eval('.home-edit-x', els => els.length);
  console.log('hide (x) buttons visible in edit mode:', hideButtons);
  if (hideButtons === 0) throw new Error('Expected .home-edit-x buttons while HOME_EDIT_MODE is true');

  // 2b. The edit button itself is highlighted while edit mode is active
  const btnHighlighted = await page.evaluate(() => document.getElementById('homeEditBtn').classList.contains('home-edit-toggle-active'));
  console.log('#homeEditBtn carries .home-edit-toggle-active while active:', btnHighlighted);
  if (!btnHighlighted) throw new Error('Expected #homeEditBtn to be highlighted (.home-edit-toggle-active) while HOME_EDIT_MODE is true');

  // 2c. Tapping into a box's own content (e.g. RIGHT NOW's "FREE TIME, tap to view" panel, which
  // normally calls goHomeSection('schedule')) must NOT navigate away while in edit mode — it's
  // easy to accidentally tap a box while trying to drag-reorder it. A real click (not calling the
  // handler directly), since this exercises the capturing listener that intercepts it.
  const rightNowPanel = await page.$('.home-edit-box .panel[onclick*="goHomeSection"]');
  if (!rightNowPanel) throw new Error("Expected to find the RIGHT NOW box's clickable panel (fresh state has no schedule assigned, so it should show the FREE TIME/tap-to-view card)");
  await rightNowPanel.click();
  await page.waitForTimeout(150);
  const tabAfterEditClick = await page.evaluate(() => CURRENT_TAB);
  console.log("CURRENT_TAB after tapping RIGHT NOW's panel while in edit mode:", tabAfterEditClick);
  if (tabAfterEditClick !== 'home') throw new Error(`Expected tapping a box in edit mode to stay on Home, but CURRENT_TAB became "${tabAfterEditClick}"`);

  // 2d. ...but the box's own hide (X) button must still work — a real click, not calling
  // hideHomeBox() directly, to prove the capturing listener's exclusion actually applies in the DOM.
  const boxIdsBefore = await page.evaluate(() => STATE.settings.homeLayout.boxOrder.slice());
  const boxHideBtn = await page.$('.home-edit-box .home-edit-x');
  if (!boxHideBtn) throw new Error('Expected at least one box to have a visible hide (X) button');
  await boxHideBtn.click();
  await page.waitForTimeout(150);
  const boxIdsAfter = await page.evaluate(() => STATE.settings.homeLayout.boxOrder);
  console.log('box hide (X) click actually hid one:', boxIdsAfter.length === boxIdsBefore.length - 1);
  if (boxIdsAfter.length !== boxIdsBefore.length - 1) throw new Error(`Expected clicking a box's (X) to remove exactly one box, went ${boxIdsBefore.length} -> ${boxIdsAfter.length}`);
  const hiddenBoxId = boxIdsBefore.find(id => !boxIdsAfter.includes(id));
  await page.evaluate((id) => showHomeBox(id), hiddenBoxId); // restore it for the rest of the test

  // 2e. Leaving edit mode restores normal tap-to-navigate behavior on the same panel
  await page.click('#homeEditBtn'); // toggle edit mode back off
  await page.waitForTimeout(150);
  const editModeOff = await page.evaluate(() => HOME_EDIT_MODE === false);
  if (!editModeOff) throw new Error('Expected HOME_EDIT_MODE to be false after toggling #homeEditBtn a second time');
  const rightNowPanelAgain = await page.$('.panel[onclick*="goHomeSection"]');
  if (!rightNowPanelAgain) throw new Error("Expected RIGHT NOW's panel to still be present outside edit mode");
  await rightNowPanelAgain.click();
  await page.waitForTimeout(150);
  const tabAfterNormalClick = await page.evaluate(() => CURRENT_TAB);
  console.log('CURRENT_TAB after tapping the same panel outside edit mode:', tabAfterNormalClick);
  if (tabAfterNormalClick !== 'schedule') throw new Error(`Expected normal (non-edit-mode) tap to navigate to Schedule, got CURRENT_TAB="${tabAfterNormalClick}"`);
  await page.evaluate(() => { switchTab('home'); toggleHomeEditMode(); }); // back to Home, back into edit mode for the rest of the test

  // 3. Hide the first section, confirm tile count drops by 1 and it persists to STATE
  const beforeIds = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder.slice());
  const targetId = beforeIds[0];
  await page.evaluate((id) => hideHomeSection(id), targetId);
  await page.waitForTimeout(150);

  const afterOrder = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder);
  const afterHidden = await page.evaluate(() => STATE.settings.homeLayout.sectionHidden);
  console.log('sectionOrder after hide:', afterOrder, '| sectionHidden:', afterHidden);
  if (afterOrder.includes(targetId)) throw new Error(`Expected '${targetId}' removed from sectionOrder after hideHomeSection`);
  if (!afterHidden.includes(targetId)) throw new Error(`Expected '${targetId}' present in sectionHidden after hideHomeSection`);

  // 4. Reload the page (simulating app relaunch) and confirm the hide persisted via localStorage
  await page.reload();
  await page.waitForTimeout(300);
  const persistedHidden = await page.evaluate(() => STATE.settings.homeLayout.sectionHidden);
  console.log('sectionHidden after reload:', persistedHidden);
  if (!persistedHidden.includes(targetId)) throw new Error('Expected hidden section to survive a reload (persisted to localStorage)');

  // 5. Show it back (cleanup) and confirm it returns
  await page.evaluate((id) => showHomeSection(id), targetId);
  await page.waitForTimeout(150);
  const restoredOrder = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder);
  if (!restoredOrder.includes(targetId)) throw new Error(`Expected '${targetId}' restored to sectionOrder after showHomeSection`);

  // 6. Each of the 6 section tiles gets its own fixed color (not shared/generic) as a vignette on
  // the tile's own background (homeTileGlowStyle()) — checked via the raw `style` attribute text
  // (unnormalized), since the color is embedded inside a radial-gradient() string rather than
  // being its own recognized CSS property browsers would normalize on read-back.
  await page.evaluate(() => { switchTab('home'); });
  await page.waitForTimeout(150);
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
  await page.waitForTimeout(150);
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
  await page.evaluate(() => { STATE.settings.homeLayout = defaultHomeLayout(); saveState(); });

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_home.js: PASS');
  process.exit(0);
})();
