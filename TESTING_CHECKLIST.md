# Manual Testing Checklist

Things that can't be verified from the sandbox (no real network to Firebase, no real iOS
keyboard/Mail app, etc.) and need a real device to actually confirm. Check items off as you
verify them; add new ones as new features ship. Automated `tests/*.js` coverage is separate —
see `tests/README.md` for that.

## Cloud Sync
- [x] Google sign-in works on a real device
- [x] Cross-device sync round-trip: sign in on device A, log something, "Sync Now" on device B,
      confirm it shows up
- [ ] Email-link sign-in — blocked right now by Firebase's 5-emails/day Spark plan quota; retry
      once the quota resets (or Blaze is on) and confirm the link arrives and signs you in
- [ ] After tapping the email link (which opens Safari) and completing sign-in there, check
      whether reopening the home-screen app icon already shows you as signed in, or whether it
      forgot the session — this tells us if Safari/home-screen-app storage is actually shared on
      your iOS version
- [ ] The new "paste the link here" flow, end to end: send link → copy from Mail → paste into
      the app → confirms sign-in without Safari ever opening
- [ ] The Cloud Sync modal's on-screen-keyboard fix, on an actual device (verified in the
      sandbox with a simulated shrunk viewport, not a real iOS keyboard) — confirm the
      SEND SIGN-IN LINK / COMPLETE SIGN-IN buttons stay reachable with the keyboard up

## PWA / install
- [x] "Add to Home Screen" installs correctly, launches full-screen
- [x] App state survives being backgrounded and reopened (the original Google-Sheets-style worry)

## Export/Import
- [x] Export → share sheet → Save to Files → reopen the file → valid JSON, on real iOS Safari
- [x] Import that file back in → "Backup restored" → data intact

## Aesthetics
- [ ] C.R.E.A.M's Home tiles: the chaos emeralds (`aesthetics/cream/gem-*.webp`) were slow to
      first-load on the phone even after the update toast — confirm they now appear promptly, and
      that once cached the tab switch to C.R.E.A.M shows them immediately. Glow halo should follow
      the stone's outline, not a square; icon + label readable over the crown in daylight.

## Reminder push notifications
- [x] Backend deployed 2026-09-11 (`https://lifeman-reminders.impactrobo.workers.dev`) and
      smoke-tested via curl — subscribe/reminders/unsubscribe round-trip, 400/404 cases all
      correct. See `docs/ROADMAP.md` "Web Push reminders".
- [x] On a real installed iOS Home Screen PWA: ENABLE REMINDER NOTIFICATIONS → grant permission →
      subscribe succeeded (no error toast)
- [x] **Verified live 2026-09-11**: a real reminder arrived as a system notification on an
      installed iOS PWA — confirms `sendWebPush()`'s hand-rolled RFC 8291/8292 encryption is
      correct end to end, the one piece that couldn't be tested from the dev sandbox. Arrived
      roughly a minute after the scheduled time, which is expected (the Worker's cron checks
      once a minute) — not a bug, nothing to fix.
- [ ] Tap the notification — confirm it opens/focuses the app rather than doing nothing
- [ ] Edit/delete a reminder while enabled — confirm the backend's copy updates (no stale
      notification for a deleted reminder)
- [ ] Put the phone in airplane mode across a reminder's scheduled time, then reconnect — this is
      the known degradation case (see ROADMAP): confirm it arrives late rather than crashing
      anything, and note whether it arrives at all
- [ ] DISABLE REMINDER NOTIFICATIONS — confirm no more notifications arrive after

## Add future items below as new features ship
