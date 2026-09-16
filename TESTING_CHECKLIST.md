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

## Exercise identity migration (2026-09-16)
The one-time migration that dissolves the six MAXES categories into per-lift maxes runs against
your REAL save the first time the updated build boots. It is covered by `test_lift_maxes.js`
against a synthetic old-shape save, but your actual data is the one fixture the sandbox never had.
- [ ] After the update, open Builder → EXERCISES: every lift you had a tested number for is listed,
      with the right T1 / T2 weights and test types. In particular, a "Squat" or "Bench" category
      you never linked should have landed on Barbell Back Squat / Barbell Bench Press — NOT on a
      custom lift called "Squat" beside it. If you see such a duplicate, that category was renamed
      or the alias missed; note which.
- [ ] Any T2 that had its own exercise name typed in (e.g. Leg Press under Squat) is now its OWN
      lift on that screen, carrying that T2's number.
- [ ] Open each GZCL workout in Builder → WORKOUT: the T1/T2 selects still name the right movement.
- [ ] Open today's session on WORKOUTS: target weights match what you'd expect from your TM, and a
      previously queued "+X starting next workout" increase is still applied.

## Weight rate & the long-cut flag (2026-09-16)
`actualPctPerWeekAt()` returned null for every input from the day the weight-plan work shipped
until 2026-09-16 — an off-by-one in its window. Because `weightPlanWeeks()` falls back to a week's
PLANNED rate when the actual is null, **every elapsed week read as planned, and the long-cut flag
could only ever have fired on what you intended rather than what you actually did.** Now fixed, so
the flag is seeing your real weight history for the first time. That's a behaviour change against
real data, and only your own log can confirm it reads correctly.
- [ ] PHASES → weight plan: elapsed weeks now show your ACTUAL rate, not the planned number. A week
      you clearly over- or under-shot should no longer read as exactly what you scheduled.
- [ ] The long-cut flag: it may fire now when it never did before. If it does, check the six-week
      run it's pointing at against what you actually remember doing — a flag on a run that wasn't
      really six hard weeks means the rate is reading wrong, not that you over-cut.
- [ ] Home → YOUR WEEK → WEIGHT: shows a rate and a band at all (it needs ~15 days of weigh-ins). A
      dash here with a full log would mean the window is off again.

## Home quick logs — the save bug (2026-09-16)
Reported from a real device and **never reproduced in the sandbox**, which is itself the evidence:
the sheet committed only on SAVE and its backdrop closed it, so dismissing the iOS number pad by
tapping outside the field discarded everything typed. A headless browser has no keyboard to dismiss,
so the same script passed every time. The fix commits each field as you type — but the diagnosis was
inferred, not observed, so it needs your device to confirm.
- [ ] Tap a chip, type a value, then tap **outside the sheet** to dismiss the keyboard. The value
      should be there when you reopen it. (This is the exact gesture that used to lose it.)
- [ ] Tap a chip, type a value, then close with the **X**. Same.
- [ ] Type a value, then swipe/kill the app without closing the sheet. Reopen — should still be
      there, since it commits on every keystroke.
- [ ] Each chip now opens only its own field. Sleep opens with Quality; nothing else pairs.
- [ ] **Drag the water number with a finger.** Up adds, down subtracts, 50 mL a step (1 fl oz in
      cups). This is the one thing here that can't be verified at all without a touchscreen — a mouse
      drag passes in the sandbox and proves nothing about Safari's gesture handling. Watch for: the
      page scrolling instead of the number changing (means `touch-action: none` isn't taking), the
      drag dying after one step, or the value jumping when you lift your finger.

## The observation scales (2026-09-16)
Hydration colour and Bristol share one mechanism: several readings a day, each timestamped, resetting
at midnight, one reading per opening of the sheet.
- [ ] Hydration colour starts **blank** each morning, with yesterday as a labelled swatch at the left
      of the strip: `YEST ▪ | OLDER ▪▪▪ NOW`. Log two or three across one day, then check the next
      day's YEST swatch is their average.
- [ ] Tap a shade, then tap **the same shade again** — it must stay logged. (It used to delete the
      reading, which is the bug that prompted this: two readings the same colour is an ordinary day.)
- [ ] Tap a different shade in the same visit — it should *correct* the reading, not add a second.
      Close the sheet, reopen, tap again — now it should be a genuine second reading.
- [ ] The **↶ clear** sits at the left of the swatches and only appears once something's selected.
- [ ] Bristol (new **STOOL** chip on the PM strip): seven types, tap one, chip shows it. A second
      reading the same day shows as `4 ·2`. Yesterday lists its readings rather than averaging them.
- [ ] The PM strip is four chips wide now (calories, water, steps, stool) — confirm it doesn't
      overrun or clip on your device. Related to the tabbar overrun item in ROADMAP.

## Breaking a habit is permanent (2026-09-16)
The only irreversible write in the app. Worth confirming it behaves *before* relying on it, since a
bug here can't be undone by definition.
- [ ] Tap the ✗ on a habit: a dialog appears naming that habit and saying it can't be undone.
      Cancel it — the day must be untouched.
- [ ] Confirm it. The day locks: tapping ✓ or ✗ again does nothing and shows "That day is locked".
- [ ] A **kept** day is still freely changeable, including changing it to broken. Only broken is sealed.
- [ ] **The shake and red flash** — does it feel right on a real screen, or is it too much / not
      enough? Timing is 520ms. This is a judgement call that can only be made on the device.
- [ ] Turn on iOS **Settings → Accessibility → Motion → Reduce Motion**, then break a habit: the
      shake and flash should be skipped entirely while the toast line still appears.

## Add future items below as new features ship
