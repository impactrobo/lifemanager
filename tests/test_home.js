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

  // 1. The section tiles are GONE (2026-09-19), in both modes.
  //
  // They left the reading view on 2026-09-18 when the bottom bar took the five sections, and
  // survived a day in edit mode on the argument that their order and hidden set still drove
  // something. That was false: SECTION_TABS is a fixed list and the bar never reads sectionOrder or
  // sectionHidden, so edit mode was a control panel for a view that no longer existed.
  //
  // Edit mode itself stays for the BOXES, which is checked below — that ordering is real, and
  // nothing in the bottom bar duplicates it.
  const tileCount = await page.$$eval('.home-tile', els => els.length);
  console.log('home tiles on load:', tileCount);
  if (tileCount !== 0) throw new Error(`Home carries no section tiles now, found ${tileCount}`);
  await page.evaluate(() => { UI.homeEditMode = true; render(); });
  await settle(page);
  const inEdit = await page.evaluate(() => ({
    tiles: document.querySelectorAll('.home-tile').length,
    boxes: document.querySelectorAll('.home-edit-box').length,
  }));
  console.log('edit mode:', JSON.stringify(inEdit));
  if (inEdit.tiles !== 0) throw new Error(`Edit mode carries no section tiles either, found ${inEdit.tiles}`);
  if (inEdit.boxes === 0) throw new Error('...but it must still offer the BOXES — that is what edit mode is for now');
  await page.evaluate(() => { UI.homeEditMode = false; render(); });
  await settle(page);

  // 2. Edit mode toggles and shows per-tile hide ("x") buttons
  // THE WAY IN IS HIDDEN (2026-09-17, by request) — the mode itself is untouched. So this drives it
  // through toggleHomeEditMode() rather than the button, and asserts the button's absence as the
  // deliberate state it is rather than discovering it as a timeout.
  const entryHidden = await page.evaluate(() =>
    document.getElementById('homeEditBtn').classList.contains('hidden'));
  console.log('#homeEditBtn hidden on Home:', entryHidden);
  if (!entryHidden) throw new Error('The Home edit button is deliberately hidden — flip HOME_EDIT_ENABLED in app-shell.js to bring it back');

  await page.evaluate(() => toggleHomeEditMode());
  await settle(page);
  const editMode = await page.evaluate(() => UI.homeEditMode === true);
  console.log('UI.homeEditMode after toggle:', editMode);
  if (!editMode) throw new Error('Expected UI.homeEditMode to be true after toggleHomeEditMode()');

  const hideButtons = await page.$$eval('.home-edit-x', els => els.length);
  console.log('hide (x) buttons visible in edit mode:', hideButtons);
  if (hideButtons === 0) throw new Error('Expected .home-edit-x buttons while UI.homeEditMode is true');

  // 2b. The edit button itself is highlighted while edit mode is active. Checks the *computed*
  // border color against a live-rendered var(--warn) probe, not just class presence — a class can
  // be attached while a same-specificity, later-in-file rule (.icon-btn) silently overrides its
  // styling, which is exactly the bug this once shipped as (see styles.css's
  // .icon-btn.home-edit-toggle-active comment). A plain classList check would never have caught it.
  // DORMANT while the button is hidden, not deleted: the cascade bug it guards is still latent in
  // styles.css, and this comes back the moment the entry point does.
  const hasClass = await page.evaluate(() => document.getElementById('homeEditBtn').classList.contains('home-edit-toggle-active'));
  if (!hasClass) throw new Error('Expected #homeEditBtn to carry .home-edit-toggle-active while UI.homeEditMode is true');
  if (entryHidden) {
    console.log('#homeEditBtn active-styling check skipped — the button is hidden, so it has no rendered border to settle');
  } else {
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
  }

  // 2c. Tapping into a box's own content must NOT navigate away while in edit mode — it's easy to
  // accidentally tap a box while trying to drag-reorder it. A real click (not calling the handler
  // directly), since this exercises the capturing listener that intercepts it. The target used to
  // be RIGHT NOW's "FREE TIME, tap to view" panel; that box folded into the day box, whose
  // OPEN CALENDAR button is the equivalent way out of Home.
  const dayBoxLink = await page.$('.home-edit-box [onclick*="goSchedule"]');
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
  await page.evaluate(() => toggleHomeEditMode()); // toggle edit mode back off
  await settle(page);
  const editModeOff = await page.evaluate(() => UI.homeEditMode === false);
  if (!editModeOff) throw new Error('Expected UI.homeEditMode to be false after toggling a second time');
  const dayBoxLinkAgain = await page.$('[onclick*="goSchedule"]');
  if (!dayBoxLinkAgain) throw new Error("Expected the day box's link through to Schedule to still be present outside edit mode");
  await dayBoxLinkAgain.click();
  await settle(page);
  const tabAfterNormalClick = await page.evaluate(() => NAV.currentTab);
  console.log('NAV.currentTab after tapping the same control outside edit mode:', tabAfterNormalClick);
  if (tabAfterNormalClick !== 'schedule') throw new Error(`Expected normal (non-edit-mode) tap to navigate to Schedule, got NAV.currentTab="${tabAfterNormalClick}"`);
  await page.evaluate(() => { switchTab('home'); toggleHomeEditMode(); }); // back to Home, back into edit mode for the rest of the test

  // 3. Hide the first BOX, and confirm it leaves the order and joins the hidden set.
  //
  // This used to hide a SECTION. Sections stopped being hideable on 2026-09-19 — the bottom bar
  // carries a fixed five and never read sectionOrder — so the checks moved to the list that is
  // still hideable rather than being deleted: what they actually pin is that hiding writes through
  // to STATE and survives a relaunch, which matters more for boxes than it ever did for tiles.
  const beforeIds = await page.evaluate(() => STATE.settings.homeLayout.boxOrder.slice());
  const targetId = beforeIds[0];
  await page.evaluate((id) => hideHomeBox(id), targetId);
  await settle(page);

  const afterOrder = await page.evaluate(() => STATE.settings.homeLayout.boxOrder);
  const afterHidden = await page.evaluate(() => STATE.settings.homeLayout.boxHidden);
  console.log('boxOrder after hide:', afterOrder, '| boxHidden:', afterHidden);
  if (afterOrder.includes(targetId)) throw new Error(`Expected '${targetId}' removed from boxOrder after hideHomeBox`);
  if (!afterHidden.includes(targetId)) throw new Error(`Expected '${targetId}' present in boxHidden after hideHomeBox`);

  // 4. Reload the page (simulating app relaunch) and confirm the hide persisted via localStorage
  await page.reload();
  await settle(page);
  const persistedHidden = await page.evaluate(() => STATE.settings.homeLayout.boxHidden);
  console.log('boxHidden after reload:', persistedHidden);
  if (!persistedHidden.includes(targetId)) throw new Error('Expected a hidden box to survive a reload (persisted to localStorage)');

  // 5. Show it back (cleanup) and confirm it returns
  await page.evaluate((id) => showHomeBox(id), targetId);
  await settle(page);
  const restoredOrder = await page.evaluate(() => STATE.settings.homeLayout.boxOrder);
  if (!restoredOrder.includes(targetId)) throw new Error(`Expected '${targetId}' restored to boxOrder after showHomeBox`);

  // 6. Each section tile gets its own fixed color (not shared/generic), painted as a thick bar
  // along its bottom edge (homeTileAccentStyle()) — checked via the raw `style` attribute text
  // (unnormalized), since the color is embedded inside a box-shadow string rather than being its
  // own recognized CSS property browsers would normalize on read-back. The assertion is about
  // each section being DISTINGUISHABLE, so it survived this changing from a vignette to a bar and
  // should survive whatever comes next.
  // Counted off sectionOrder rather than hardcoded: SCHEDULE retired as a tile when Home started
  // rendering the schedule itself, and the number will move again.
  // The colour contract did not go with the tiles — it moved to the bottom bar, which paints each
  // tab from the same HOME_SECTION_META entries. test_home_bar.js owns it now (one colour per
  // section, no two alike, read from the meta rather than a second copy), so it is not restated
  // here; restating it in two files is how the two ends drift.
  //
  // 7. Reordering, now that BOXES are the only reorderable list.
  //
  // The insertAfter contract is the part worth keeping and has nothing to do with sections:
  // dropping "before" a target could never land an item in the true LAST slot, because nothing
  // exists after the last item to drop before. insertAfter=true on the current last item is what
  // onHomeDragMove() sends when the pointer is past that item's far edge, and it must actually
  // produce the real last position.
  await page.evaluate(() => { switchTab('home'); STATE.settings.homeLayout = defaultHomeLayout(); saveState(); });
  await settle(page);
  const orderBefore = await page.evaluate(() => STATE.settings.homeLayout.boxOrder.slice());
  const firstId = orderBefore[0], lastId = orderBefore[orderBefore.length - 1];
  if (orderBefore.length < 3) throw new Error('This check needs at least three boxes to be meaningful');
  await page.evaluate((args) => reorderHomeList('boxes', args.firstId, args.lastId, true), { firstId, lastId });
  const orderAfterInsertAfter = await page.evaluate(() => STATE.settings.homeLayout.boxOrder);
  console.log('box order before/after moving the first onto the last with insertAfter=true:', orderBefore, '/', orderAfterInsertAfter);
  if (orderAfterInsertAfter[orderAfterInsertAfter.length - 1] !== firstId) {
    throw new Error(`Expected "${firstId}" to land in the true last slot, got order ${JSON.stringify(orderAfterInsertAfter)}`);
  }
  if (orderAfterInsertAfter[orderAfterInsertAfter.length - 2] !== lastId) {
    throw new Error(`Expected the old last item "${lastId}" to now sit second-to-last, got order ${JSON.stringify(orderAfterInsertAfter)}`);
  }

  // insertAfter=false (or omitted) on the same drop still inserts *before* the target, unaffected
  // — confirms the fix is additive, not a change to the existing default behavior.
  await page.evaluate(() => { STATE.settings.homeLayout = defaultHomeLayout(); saveState(); });
  await page.evaluate((args) => reorderHomeList('boxes', args.firstId, args.lastId), { firstId, lastId });
  const orderAfterBefore = await page.evaluate(() => STATE.settings.homeLayout.boxOrder);
  console.log('box order after the same move without insertAfter:', orderAfterBefore);
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
