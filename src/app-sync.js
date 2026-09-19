// app-sync.js -- The two opt-in network features, inert until enabled: Cloud Sync and reminder push notifications.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ================= CLOUD SYNC (opt-in) =================
// Nothing in this section ever runs unless the person explicitly taps "Enable Cloud Sync" in
// Settings. Until then, zero network calls happen, zero login prompts appear, and the app
// behaves exactly as it always has (local-only, localStorage). This is deliberate — see
// PROJECT_OVERVIEW.md's local-first philosophy and CLAUDE.md's Cloud Sync notes.
//
// Data model: one Firestore document per signed-in user, at users/{uid}, holding the entire
// STATE blob as a JSON string plus its own updatedAt. Sync compares STATE.updatedAt (local)
// against the remote doc's updatedAt and keeps whichever is newer — a simple last-write-wins
// model, which is the right level of complexity for one person's data synced across their own
// couple of devices (not a multi-editor conflict-resolution problem).
const firebaseConfig = {
  apiKey: "AIzaSyASBHVcfN4rQ3v8X-CUzQBsMhJ-7pb3-z4",
  authDomain: "lifemanager-sync.firebaseapp.com",
  projectId: "lifemanager-sync",
  storageBucket: "lifemanager-sync.firebasestorage.app",
  messagingSenderId: "149717482089",
  appId: "1:149717482089:web:8763a70a31891a4edfc0f8",
};
let CLOUD_SYNC_READY = false;
let CLOUD_USER = null; // Firebase auth user object, or null when signed out
let CLOUD_SYNC_STATUS = 'idle'; // 'idle' | 'syncing' | 'synced' | 'error'
let CLOUD_SYNC_ERROR = null;
function initCloudSync() {
  if (typeof firebase === 'undefined') { CLOUD_SYNC_ERROR = 'Firebase SDK failed to load (are you offline, or is a script blocked?)'; return; }
  try {
    firebase.initializeApp(firebaseConfig);
    // Firestore's own offline cache — this is what lets Cloud Sync keep working (queuing writes,
    // reading last-synced data) even with no connection, syncing automatically once back online.
    firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch((e) => {
      console.warn('Firestore offline persistence unavailable (e.g. private browsing, or already open in another tab set):', e.code);
    });
    firebase.auth().onAuthStateChanged((user) => {
      CLOUD_USER = user;
      if (user && STATE.settings.cloudSync.enabled) {
        pullThenSync();
      }
      render();
    });
    // Completes an email-link sign-in if this page load IS that link being opened
    if (firebase.auth().isSignInWithEmailLink(window.location.href)) {
      let email = window.localStorage.getItem('cloudSyncPendingEmail');
      if (!email) email = window.prompt('Confirm the email address you used for the sync link:');
      if (email) {
        firebase.auth().signInWithEmailLink(email, window.location.href)
          .then(() => {
            window.localStorage.removeItem('cloudSyncPendingEmail');
            STATE.settings.cloudSync.enabled = true;
            saveState();
            showToast('Signed in — cloud sync enabled');
            // Clean the sign-in link's query params out of the visible URL
            window.history.replaceState({}, document.title, window.location.pathname);
          })
          .catch((e) => showToast('Sign-in link failed: ' + e.message));
      }
    }
    CLOUD_SYNC_READY = true;
  } catch (e) {
    CLOUD_SYNC_ERROR = e.message;
    console.error('Cloud Sync init failed', e);
  }
}
function openCloudSyncModal() { UI.cloudSyncModalOpen = true; render(); }
function closeCloudSyncModal() { UI.cloudSyncModalOpen = false; CLOUD_SYNC_EMAIL_LINK_SENT = false; render(); }
function signInWithGoogle() {
  if (!CLOUD_SYNC_READY) { showToast('Cloud Sync isn\'t available right now'); return; }
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider)
    .then(() => {
      STATE.settings.cloudSync.enabled = true;
      saveState();
      closeCloudSyncModal();
      showToast('Signed in — cloud sync enabled');
    })
    .catch((e) => {
      if (e.code === 'auth/popup-closed-by-user') return; // user cancelled — no error toast
      showToast('Google sign-in failed: ' + e.message);
    });
}
function sendEmailSignInLink(email) {
  if (!CLOUD_SYNC_READY) { showToast('Cloud Sync isn\'t available right now'); return; }
  if (!email || !email.includes('@')) { showToast('Enter a valid email first'); return; }
  const actionCodeSettings = { url: window.location.href, handleCodeInApp: true };
  firebase.auth().sendSignInLinkToEmail(email, actionCodeSettings)
    .then(() => {
      window.localStorage.setItem('cloudSyncPendingEmail', email);
      CLOUD_SYNC_EMAIL_LINK_SENT = true; // switches the modal into "paste it here" mode — see renderCloudSyncModal()
      render();
    })
    .catch((e) => showToast('Could not send sign-in link: ' + e.message));
}
let CLOUD_SYNC_EMAIL_LINK_SENT = false;
// Alternative completion path to tapping the emailed link directly (which opens Safari, not the
// installed home-screen app — see CLAUDE.md's Cloud Sync notes). Instead: long-press the link in
// Mail -> Copy Link -> paste it here. Runs the exact same Firebase completion check, just against
// pasted text instead of window.location.href, so it finishes without ever leaving the app.
function completeEmailSignInFromPastedLink(pastedText) {
  const link = (pastedText || '').trim();
  if (!link) { showToast('Paste the link from your email first'); return; }
  if (!CLOUD_SYNC_READY) { showToast('Cloud Sync isn\'t available right now'); return; }
  if (!firebase.auth().isSignInWithEmailLink(link)) { showToast('That doesn\'t look like a valid sign-in link'); return; }
  const email = window.localStorage.getItem('cloudSyncPendingEmail');
  if (!email) { showToast('Lost track of which email this was for — try sending a new link'); return; }
  firebase.auth().signInWithEmailLink(email, link)
    .then(() => {
      window.localStorage.removeItem('cloudSyncPendingEmail');
      CLOUD_SYNC_EMAIL_LINK_SENT = false;
      STATE.settings.cloudSync.enabled = true;
      saveState();
      closeCloudSyncModal();
      showToast('Signed in — cloud sync enabled');
    })
    .catch((e) => showToast('Sign-in failed: ' + e.message));
}
function signOutCloudSync() {
  showConfirm('Sign out of Cloud Sync? Your data stays on this device either way.', () => {
    firebase.auth().signOut().then(() => {
      STATE.settings.cloudSync.enabled = false;
      saveState();
      showToast('Signed out of cloud sync');
      render();
    });
  });
}
function userDocRef() { return firebase.firestore().collection('users').doc(CLOUD_USER.uid); }
// Pulls the remote copy once at sign-in time and keeps whichever side is newer — this only
// runs right after signing in, specifically so a second device's existing local data doesn't
// get silently clobbered the moment it connects for the first time.
function pullThenSync() {
  if (!CLOUD_USER) return;
  CLOUD_SYNC_STATUS = 'syncing'; render();
  userDocRef().get().then((doc) => {
    if (doc.exists) {
      const remote = doc.data();
      const remoteUpdatedAt = remote.updatedAt || 0;
      const localUpdatedAt = STATE.updatedAt || 0;
      if (remoteUpdatedAt > localUpdatedAt) {
        // Same adoption contract as boot and as importing a backup (see importData): the remote
        // blob may have been written by an older build, so it needs loadState()'s per-key merge
        // and migrateState()'s backfills, not a shallow assign.
        localStorage.setItem(STORAGE_KEY, remote.data);
        STATE = loadState();
        adoptState();   // the same door boot and import use — see adoptState() in app-state.js
        localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); // skip saveState() here — avoid re-triggering a push of what we just pulled
        showToast('Synced — pulled your other device\'s newer data');
        render();
      } else if (localUpdatedAt > remoteUpdatedAt) {
        pushStateToCloud();
      }
    } else {
      pushStateToCloud(); // first-ever sync for this account — nothing remote yet
    }
    CLOUD_SYNC_STATUS = 'synced'; render();
  }).catch((e) => {
    CLOUD_SYNC_STATUS = 'error'; CLOUD_SYNC_ERROR = e.message; render();
  });
}
let _cloudPushDebounceTimer = null;
// Called from saveState() itself — a no-op unless sync is actually on, and debounced so rapid
// local edits (typing, dragging) don't fire a network write on every keystroke.
function queueCloudPush() {
  if (!STATE.settings.cloudSync.enabled || !CLOUD_USER) return;
  clearTimeout(_cloudPushDebounceTimer);
  _cloudPushDebounceTimer = setTimeout(pushStateToCloud, 1500);
}
function pushStateToCloud() {
  if (!CLOUD_USER) return;
  CLOUD_SYNC_STATUS = 'syncing';
  userDocRef().set({ data: JSON.stringify(STATE), updatedAt: STATE.updatedAt, email: CLOUD_USER.email || null })
    .then(() => { CLOUD_SYNC_STATUS = 'synced'; render(); })
    .catch((e) => { CLOUD_SYNC_STATUS = 'error'; CLOUD_SYNC_ERROR = e.message; render(); });
}
// Manual "Sync Now" button — same logic as the sign-in-time pull, just re-runnable any time.
function manualSyncNow() {
  if (!CLOUD_USER) { showToast('Not signed in'); return; }
  pullThenSync();
}
function renderCloudSyncPanel() {
  if (!STATE.settings.cloudSync.enabled || !CLOUD_USER) {
    return `<button class="btn btn-block" onclick="openCloudSyncModal()">ENABLE CLOUD SYNC</button>
      <div style="font-size:11px; color:var(--text-faint); margin-top:8px;">Optional — sync your data across your own devices. Off by default; nothing is sent anywhere unless you turn this on.</div>`;
  }
  const statusLabel = { idle: 'Ready', syncing: 'Syncing…', synced: 'Synced', error: 'Sync error' }[CLOUD_SYNC_STATUS] || '';
  return `
    <div style="font-size:12px; color:var(--text-dim); margin-bottom:10px;">Signed in as ${escapeHtml(CLOUD_USER.email || CLOUD_USER.displayName || 'this account')} &middot; <span style="color:${CLOUD_SYNC_STATUS==='error'?'var(--bad)':'var(--good)'};">${statusLabel}</span></div>
    ${CLOUD_SYNC_STATUS === 'error' ? `<div style="font-size:11px; color:var(--bad); margin-bottom:8px;">${escapeHtml(CLOUD_SYNC_ERROR || '')}</div>` : ''}
    <button class="btn btn-block" onclick="manualSyncNow()">SYNC NOW</button>
    <button class="btn btn-block" style="margin-top:8px;" onclick="signOutCloudSync()">SIGN OUT OF SYNC</button>
  `;
}
function renderCloudSyncModal() {
  if (!UI.cloudSyncModalOpen) return '';
  const body = CLOUD_SYNC_EMAIL_LINK_SENT ? `
        <div style="font-size:12px; color:var(--text-dim); margin-bottom:12px;">Check your email for the sign-in link. Tapping it works, but opens in Safari instead of this app — for the smoothest experience, long-press the link in Mail, tap <b>Copy Link</b>, then paste it below.</div>
        <label class="field" style="margin-bottom:8px;"><span class="lbl">Paste the link here</span><textarea id="cloudSyncPastedLink" rows="3" placeholder="https://..."></textarea></label>
        <button class="btn btn-primary btn-block" onclick="completeEmailSignInFromPastedLink(inputVal('cloudSyncPastedLink'))">COMPLETE SIGN-IN</button>
        <button class="btn btn-ghost btn-block btn-sm" style="margin-top:8px;" onclick="CLOUD_SYNC_EMAIL_LINK_SENT=false; render();">&#8249; Send to a different email</button>
      ` : `
        <button class="btn btn-primary btn-block" onclick="signInWithGoogle()">CONTINUE WITH GOOGLE</button>
        <div class="divider" style="margin:14px 0;"></div>
        <label class="field" style="margin-bottom:8px;"><span class="lbl">Email</span><input type="email" id="cloudSyncEmailInput" placeholder="you@example.com"></label>
        <button class="btn btn-block" onclick="sendEmailSignInLink(inputVal('cloudSyncEmailInput').trim())">SEND SIGN-IN LINK</button>
      `;
  return `
    <div class="home-popup-backdrop" style="align-items:flex-start; padding-top:48px; overflow-y:auto;" onclick="closeCloudSyncModal()">
      <div class="panel" style="width:100%; max-width:640px; margin:0 12px; border-radius:var(--radius);" onclick="event.stopPropagation()">
        <div class="row" style="margin-bottom:10px;">
          <div class="subtle-label" style="margin-bottom:0;">ENABLE CLOUD SYNC</div>
          <button class="icon-btn" onclick="closeCloudSyncModal()">${icon('close')}</button>
        </div>
        ${body}
      </div>
    </div>`;
}
initCloudSync();

// ================= REMINDER PUSH (opt-in) =================
// Nothing here ever runs unless the person taps "ENABLE REMINDER NOTIFICATIONS" in Settings —
// same opt-in discipline as Cloud Sync above. Delivers STATE.reminders as real system
// notifications via Web Push, so they fire even when the app isn't open. See docs/ROADMAP.md
// "Web Push reminders" for the full design writeup and its known limitation: this only works
// while the phone has connectivity near the reminder's time (it's a server round-trip, not
// on-device scheduling — iOS has no working API for the latter). A native wrapper is the
// eventual fix for offline/exact-timing reliability; this is the interim, ship-able version.
//
// Backend: a small always-on service (not part of this app.js bundle) that (a) stores each
// subscription's reminder list and (b) on a ~1-minute tick, sends a Web Push to any subscription
// with a reminder due right now. See reminder-worker/ once it exists. REMINDER_BACKEND_URL is a
// placeholder until that's deployed — every call below no-ops with a clear toast until it's set.
const REMINDER_BACKEND_URL = 'https://lifeman-reminders.impactrobo.workers.dev'; // deployed 2026-09-11 — see reminder-worker/
// Public half of the VAPID keypair (see reminder-worker/README.md for how it was generated and
// where the private half lives). Public keys are not secret — safe to ship in app.js.
const VAPID_PUBLIC_KEY = 'BLLrzqIbNsw-lmf5hDGsBAnx0ryQ4CwDsmrXrCAj0asLODcdI1CmoWA80ZIq2HkYDKJXr7-Zp-58f1rjomX0i4E';

let REMINDER_PUSH_SUPPORTED = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
let REMINDER_PUSH_STATUS = 'idle'; // 'idle' | 'working' | 'error'
let REMINDER_PUSH_ERROR = null;

// PushManager wants the VAPID public key as a raw Uint8Array, not the base64url string used
// everywhere else it's handled — this is the standard conversion (MDN's own recipe).
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
// iOS only exposes Push to a Home-Screen install, never a Safari tab (see docs/ROADMAP.md).
// `navigator.standalone` is Safari-only truth for "launched from the home screen icon"; other
// browsers/platforms use the display-mode media query instead.
function isInstalledStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}
function backendConfigured() { return !!REMINDER_BACKEND_URL; }
async function postToReminderBackend(path, body) {
  const res = await fetch(REMINDER_BACKEND_URL + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Backend responded ' + res.status);
}
async function enableReminderPush() {
  if (!REMINDER_PUSH_SUPPORTED) { showToast('This browser doesn\'t support notifications'); return; }
  if (!backendConfigured()) { showToast('Reminder notifications aren\'t set up yet — the backend hasn\'t been deployed'); return; }
  const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
  if (isIos && !isInstalledStandalone()) {
    showToast('Add this app to your Home Screen first (Share → Add to Home Screen), then try again from there');
    return;
  }
  REMINDER_PUSH_STATUS = 'working'; render();
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      REMINDER_PUSH_STATUS = 'idle';
      showToast(permission === 'denied' ? 'Notifications blocked — enable them for this app in system settings to turn this on' : 'Notification permission dismissed');
      render();
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    // Timezone travels with the reminders because the backend runs in UTC and reminders are
    // stored as plain local date/time strings with no zone of their own — the Worker needs this
    // to know what "now" means for a Sept 9 09:00 reminder. See reminder-worker/src/index.js.
    await postToReminderBackend('/subscribe', { subscription: sub.toJSON(), reminders: STATE.reminders, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    STATE.settings.reminderPush.enabled = true;
    saveState();
    REMINDER_PUSH_STATUS = 'idle';
    showToast('Reminder notifications enabled');
  } catch (e) {
    REMINDER_PUSH_STATUS = 'error'; REMINDER_PUSH_ERROR = e.message;
    showToast('Could not enable reminder notifications: ' + e.message);
  }
  render();
}
async function disableReminderPush() {
  REMINDER_PUSH_STATUS = 'working'; render();
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      if (backendConfigured()) { try { await postToReminderBackend('/unsubscribe', { endpoint: sub.endpoint }); } catch (e) { /* best-effort — still unsubscribe locally */ } }
      await sub.unsubscribe();
    }
  } catch (e) { /* fall through — still clear the local flag so Settings doesn't get stuck */ }
  STATE.settings.reminderPush.enabled = false;
  saveState();
  REMINDER_PUSH_STATUS = 'idle';
  showToast('Reminder notifications turned off');
  render();
}
let _reminderPushSyncDebounceTimer = null;
// Called whenever STATE.reminders changes (see saveReminder()/deleteReminder()). No-op unless
// the feature is actually on — mirrors queueCloudPush()'s debounce so rapid edits (e.g. deleting
// several reminders in a row) don't fire a network call per edit.
// What actually gets sent to the push backend. A lead-time reminder's stored title is left exactly
// as typed (STATE.reminders is never touched here) — only the payload gets a "due <date>" suffix,
// because a notification that arrives before the thing it's about needs to say so, or it just
// reads as wrong rather than early. Pulled out as its own function so this is testable directly,
// without mocking the network call it would otherwise be buried inside.
function reminderPushPayload() {
  // Checked-off reminders are dropped rather than dimmed here: the backend has no concept of
  // "done", it just fires whatever it was last given on the matching date+time. Not sending it is
  // the only way to stop the notification, and un-checking re-syncs it on the next edit.
  return STATE.reminders.filter(r => !reminderIsDone(r)).map(r => {
    const ctx = reminderDueContext(r);
    return ctx ? Object.assign({}, r, { title: `${r.title} — due ${fmtDueDate(ctx.dueDate)}` }) : r;
  });
}
function queueReminderPushSync() {
  if (!STATE.settings.reminderPush.enabled || !backendConfigured()) return;
  clearTimeout(_reminderPushSyncDebounceTimer);
  _reminderPushSyncDebounceTimer = setTimeout(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return; // subscription got lost somehow — ENABLE will re-create it next time it's pressed
      await postToReminderBackend('/reminders', { endpoint: sub.endpoint, reminders: reminderPushPayload(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    } catch (e) { console.warn('Reminder sync to backend failed (will retry on next edit):', e.message); }
  }, 1500);
}
function renderReminderPushPanel() {
  if (!REMINDER_PUSH_SUPPORTED) {
    return `<div style="font-size:11px; color:var(--text-faint);">Not supported in this browser.</div>`;
  }
  if (!STATE.settings.reminderPush.enabled) {
    return `<button class="btn btn-block" onclick="enableReminderPush()" ${REMINDER_PUSH_STATUS==='working'?'disabled':''}>${REMINDER_PUSH_STATUS==='working'?'ENABLING…':'ENABLE REMINDER NOTIFICATIONS'}</button>
      <div style="font-size:11px; color:var(--text-faint); margin-top:8px;">Optional — get a system notification when a reminder is due, even with the app closed. On iPhone, add this app to your Home Screen first, and it only works while your phone has a connection around the reminder's time.</div>`;
  }
  return `
    <div style="font-size:12px; color:var(--text-dim); margin-bottom:10px;">Enabled &middot; <span style="color:${REMINDER_PUSH_STATUS==='error'?'var(--bad)':'var(--good)'};">${REMINDER_PUSH_STATUS==='error'?'Error':'On'}</span></div>
    ${REMINDER_PUSH_STATUS === 'error' ? `<div style="font-size:11px; color:var(--bad); margin-bottom:8px;">${escapeHtml(REMINDER_PUSH_ERROR || '')}</div>` : ''}
    <button class="btn btn-block" onclick="disableReminderPush()" ${REMINDER_PUSH_STATUS==='working'?'disabled':''}>${REMINDER_PUSH_STATUS==='working'?'WORKING…':'DISABLE REMINDER NOTIFICATIONS'}</button>
  `;
}

function resetAllData() {
  showConfirm('This erases everything stored on this device — training maxes, workout logs, measurements, weight log. This cannot be undone. Continue?', () => {
    STATE = defaultState(); // reset in-memory first — never skipped even if storage access below fails
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('Could not clear localStorage', e);
    }
    saveState(); // persist the fresh defaults (saveState has its own try/catch + toast on failure)
    showToast('All data reset');
    render();
  });
}
// Resets cosmetics only — aesthetic/accent and Home's button+box layout — plus collapses every
// expand/collapse UI toggle back to closed. Deliberately never touches STATE.workouts/logs/
// measurements/etc.; RESET ALL DATA above is the one that does that.
function resetUI() {
  showConfirm('Reset the aesthetic, accent color, and Home screen layout back to their defaults? Your logged data is not affected.', () => {
    STATE.settings.aesthetic = 'cyberpunk';
    STATE.settings.accentByAesthetic = {};
    STATE.settings.homeLayout = defaultHomeLayout();
    UI.homeEditMode = false;
    UI.homeAddPopup = null;
    UI.bodyFormOpen = false;
    UI.bodyEditDate = null;
    UI.bodyDetailOpen = false;
    UI.tdeeCalcOpen = false;
    UI.builderStylePickerOpen = false;
    UI.autofillPickerOpen = false;
    VIEW.mealPlanExpanded = {};
    VIEW.exPlanExpanded = {};
    saveState();
    applyAesthetic();
    renderAestheticOptions();
    renderAccentSwatches();
    showToast('UI reset to factory settings');
    render();
  });
}
