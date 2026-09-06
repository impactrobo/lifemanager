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

## Add future items below as new features ship
