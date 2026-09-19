// app-boot.js -- Everything that runs at startup, in order. Must load LAST.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// Mobile browsers never let a scroll/wheel gesture change a focused number input's value —
// only desktop does, via the native spin behavior — so block that path everywhere the spin
// buttons themselves are already hidden by CSS, and just let the gesture scroll the page instead.
document.addEventListener('wheel', function(e) {
  const t = /** @type {any} */ (e.target);
  if (t && t.tagName === 'INPUT' && t.type === 'number') {
    e.preventDefault();
    window.scrollBy(0, e.deltaY);
  }
}, { passive: false });

// Migrations, the blank-note sweep, the reminder top-up, aesthetic and handedness — shared with the
// cloud-pull and backup-import paths so the three cannot drift apart. See adoptState() in
// src/app-state.js.
adoptState();
// Booting straight into Notes (Settings > Default Page) has to land on the same new blank note that
// arriving via switchTab() does. NAV.currentTab was set by initialTab() during script evaluation,
// so this branch is the only place that path passes through. Boot-only: it is about ARRIVING, not
// about adopting the state, which is why it is not in adoptState().
if (NAV.currentTab === 'notes') openBlankEntry();
document.getElementById('settingsBtn').innerHTML = icon('settings');
document.getElementById('homeBtn').innerHTML = icon('home');
document.getElementById('homeEditBtn').innerHTML = icon('pencil');
document.getElementById('backBtn').innerHTML = icon('back');
document.getElementById('forwardBtn').innerHTML = icon('forward');
document.getElementById('restTimerFab').innerHTML = icon('timer');
render();

// One-time "you're now on the latest build" confirmation, shown after an auto-update reload
// (see the auto-update block below) so the refresh doesn't look like a random flash.
try {
  if (sessionStorage.getItem('lm_updated')) {
    sessionStorage.removeItem('lm_updated');
    setTimeout(() => showToast('Updated to the latest version'), 400);
  }
} catch (e) {}

// ================= AUTO-UPDATE =================
// Keeps an installed PWA from getting stuck on a stale build. iOS resumes a home-screen web
// app from a process snapshot without re-navigating, so the network-first service worker below
// never gets a chance to refresh on its own. Instead: on launch and on every return to the
// foreground, cheaply re-fetch index.html and compare its <meta name="app-build"> stamp to the
// one THIS page loaded with. If a newer deploy is live, reload (deferring if the user is
// mid-typing). Bumping that one meta tag in index.html is all a deploy needs.
(function autoUpdate() {
  const meta = document.querySelector('meta[name="app-build"]');
  const APP_BUILD = meta ? (meta.getAttribute('content') || '') : '';
  if (!APP_BUILD) return; // no stamp to compare against — feature off

  let lastCheck = 0;
  let reloading = false;
  let pendingReload = false;

  function isTyping() {
    const el = /** @type {any} */ (document.activeElement);
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }
  function reloadForUpdate() {
    if (reloading) return;
    if (isTyping()) { pendingReload = true; return; } // don't yank the page mid-entry
    reloading = true;
    try { sessionStorage.setItem('lm_updated', '1'); } catch (e) {}
    location.reload();
  }
  async function check() {
    if (reloading || !navigator.onLine) return;
    const now = Date.now();
    if (now - lastCheck < 60000) return; // at most once a minute
    lastCheck = now;
    try {
      const res = await fetch('index.html', { cache: 'no-store' });
      if (!res.ok) return;
      const html = await res.text();
      const m = html.match(/<meta name="app-build" content="([^"]*)"/);
      if (m && m[1] && m[1] !== APP_BUILD) reloadForUpdate();
    } catch (e) { /* offline / transient — retry on next foreground */ }
  }

  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (pendingReload) reloadForUpdate(); else check();
  });
  // If a reload was deferred because a field was focused, take it the moment focus leaves.
  document.addEventListener('focusout', () => { if (pendingReload) reloadForUpdate(); });
  // Manual "check for updates now" hook — handy from the console, and what the test drives.
  // Bypasses the foreground-spam throttle since it's an explicit request.
  window._lmCheckForUpdate = () => { lastCheck = 0; return check(); };
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => { reg.update().catch(() => {}); })
      .catch(() => {});
  });
}
