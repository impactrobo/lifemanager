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
- [x] C.R.E.A.M's Home tiles: the chaos emeralds (`aesthetics/cream/gem-*.webp`) were slow to
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
- [x] After the update, open Builder → EXERCISES: every lift you had a tested number for is listed,
      with the right T1 / T2 weights and test types. In particular, a "Squat" or "Bench" category
      you never linked should have landed on Barbell Back Squat / Barbell Bench Press — NOT on a
      custom lift called "Squat" beside it. If you see such a duplicate, that category was renamed
      or the alias missed; note which.
- [x] Any T2 that had its own exercise name typed in (e.g. Leg Press under Squat) is now its OWN
      lift on that screen, carrying that T2's number.
- [x] Open each GZCL workout in Builder → WORKOUT: the T1/T2 selects still name the right movement.
- [x] Open today's session on WORKOUTS: target weights match what you'd expect from your TM, and a
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
- [x] Tap a chip, type a value, then tap **outside the sheet** to dismiss the keyboard. The value
      should be there when you reopen it. (This is the exact gesture that used to lose it.)
- [x] Tap a chip, type a value, then close with the **X**. Same.
- [x] Type a value, then swipe/kill the app without closing the sheet. Reopen — should still be
      there, since it commits on every keystroke.
- [x] Each chip now opens only its own field. Sleep opens with Quality; nothing else pairs.
- [x] **Drag the water number with a finger.** Up adds, down subtracts, 50 mL a step (1 fl oz in
      cups). This is the one thing here that can't be verified at all without a touchscreen — a mouse
      drag passes in the sandbox and proves nothing about Safari's gesture handling. Watch for: the
      page scrolling instead of the number changing (means `touch-action: none` isn't taking), the
      drag dying after one step, or the value jumping when you lift your finger.

## The observation scales (2026-09-16)
Hydration colour and Bristol share one mechanism: several readings a day, each timestamped, resetting
at midnight, one reading per opening of the sheet.
- [x] Hydration colour starts **blank** each morning, with yesterday as a labelled swatch at the left
      of the strip: `YEST ▪ | OLDER ▪▪▪ NOW`. Log two or three across one day, then check the next
      day's YEST swatch is their average.
- [x] Tap a shade, then tap **the same shade again** — it must stay logged. (It used to delete the
      reading, which is the bug that prompted this: two readings the same colour is an ordinary day.)
- [x] Tap a different shade in the same visit — it should *correct* the reading, not add a second.
      Close the sheet, reopen, tap again — now it should be a genuine second reading.
- [x] The **↶ clear** sits at the left of the swatches and only appears once something's selected.
- [x] Bristol (new **STOOL** chip on the PM strip): seven types, tap one, chip shows it. A second
      reading the same day shows as `4 ·2`. Yesterday lists its readings rather than averaging them.
- [x] The PM strip is four chips wide now (calories, water, steps, stool) — confirm it doesn't
      overrun or clip on your device. Related to the tabbar overrun item in ROADMAP.

## Breaking a habit is permanent (2026-09-16)
The only irreversible write in the app. Worth confirming it behaves *before* relying on it, since a
bug here can't be undone by definition.
- [x] Tap the ✗ on a habit: a dialog appears naming that habit and saying it can't be undone.
      Cancel it — the day must be untouched.
- [x] Confirm it. The day locks: tapping ✓ or ✗ again does nothing and shows "That day is locked".
- [x] A **kept** day is still freely changeable, including changing it to broken. Only broken is sealed.
- [x] **The shake and red flash** — does it feel right on a real screen, or is it too much / not
      enough? Timing is 520ms. This is a judgement call that can only be made on the device.
- [x] Turn on iOS **Settings → Accessibility → Motion → Reduce Motion**, then break a habit: the
      shake and flash should be skipped entirely while the toast line still appears.

## The navigation restructure (2026-09-17) — DO FIRST
Seven moves across builds `-23` to `2026.09.17-1`. Most of it is verifiable in a sandbox; what isn't
is that **your installed app carries a saved nav snapshot pointing at tabs that no longer exist**,
and that your real data made the journey. `test_diet_dissolved.js` covers the redirects against a
synthetic snapshot — yours is the one fixture the sandbox never had.
- [x] Open the installed app cold. It should land on a real screen, not a blank one with the bottom
      bar missing its section buttons. (A stale `diet` subtab now redirects to **D&E → MEALS**;
      `longevity` to **BUILDER → SUPPLEMENTS**; `lifts` to **BUILDER → EXERCISES**.)
- [x] Whichever tab it lands on, the bottom bar has the matching button **lit**. A bar and a screen
      disagreeing about where you are is how the last stale-tab bug showed itself.
- [x] **The bottom bar is four buttons now** (DIET & EXERCISE / PHASES / BUILDER / PROGRESS) — down
      from five, then six. Confirmed to fit on device, which closes the ROADMAP overrun item. The
      exercise tab reads DIET & EXERCISE over two lines rather than the D&E initialism, and BODY was
      renamed PROGRESS once WEIGHT and MEASUREMENTS merged into a BODY *sub*tab beneath it.
- [x] Your **supplement regimen** is intact under BUILDER → DIET → SUPPLEMENTS — same items, doses,
      stacks and slots. The daily tick is still on Home.
- [x] Your **calorie and macro targets** show up in PHASES → MEAL PLAN under TARGETS TO MEET, with
      the right phase named as their source.
- [ ] TDEE now sits in its **own panel above** the calorie/macro targets, opened with a disclosure
      arrow rather than a gear, showing the current value even while closed. (TDEE is what the target
      is derived *from*, so it sits above rather than hidden behind what it produces; a gear implies
      "configure this", and what's there is a readout.) Still unticked in the field.
- [x] Your **diet log** history is intact under D&E → MEALS, paging back through days.
- [x] Past phases are under PHASES → ARCHIVED, newest first, and the live ones are still on NEW.
- [x] BODY → COMPARE offers a **MUSCLES** group, and it lists the parts you've actually measured
      twice — not all sixteen.
- [x] Adding a lift to training maxes offers a **Nickname** field under the name, and the shorthand
      shows up where that lift is referenced.

## NetNavis (2026-09-17)
Nothing is selected by default, so none of this appears until you pick one in Settings.
- [x] Settings → NETNAVI: six portraits load. Pick one; tap **HEAR &lt;NAME&gt;** — the dialogue box
      rises from the bottom.
- [x] **The box sits above the bottom bar without colliding with the home indicator.** It carries
      `env(safe-area-inset-bottom)`, which a sandbox viewport can't reproduce.
- [x] Tapping the box advances a line; the last tap closes it. Navigating away closes it too.
- [x] Home → YOUR WEEK → **ASK &lt;NAVI&gt;** delivers your actual week in that Navi's voice, and the
      numbers agree with the headline and chips above it.
- [ ] **Vitalya's register is a judgement call only you can make.** Her profile has her calling you
      something "slightly mean… about being overweight, inactive, or lazy". It ships as written. Read
      it on a real screen on a real week and say whether it lands or grates — the set is one line to
      change, and picking someone else is always the other answer.
- [x] Airplane mode, open the app, tap a Navi: **the portrait still renders.** The six icons are
      precached; a box with a broken portrait is worse than no box.

## Offline cache & self-update (2026-09-17)
`CACHE_NAME` went `lifeman-v16` → `v17` and `APP_SHELL` gained seven entries (`app-navi.js` plus six
portraits). `addAll()` rejects **wholesale** on a single 404, and the failure is silent — the offline
cache simply never installs, and you'd only find out with no signal.
- [x] After updating, put the phone in airplane mode and cold-launch the installed app. It should
      load fully, not show a browser error page.
- [x] The app self-updated to build `2026.09.17-2` without being reinstalled — check the stamp via
      the update toast, or `window._lmCheckForUpdate()` from a console.

## Phases: rotation length, folding cards, planner scope (2026-09-16)
- [x] The bug you reported: **a rotation can now be set to something other than 7 days.** It locks
      only once you've actually logged a session inside that phase, not the moment it starts.
- [x] Phase cards fold, one open at a time; **DONE** closes one and the card shows a brief
      "✓ saved" when a field commits.
- [x] Both planners show **"Adding to which phase"** even when there's only one phase.

## YOUR DAY (2026-09-16)
- [x] Home's day panel is one panel, not two — the old "today's schedule" summary is gone and the
      count moved into the header.
- [x] Let a scheduled activity's time pass without marking it: a **glowing `!`** appears in the
      schedule header. Does the pulse read clearly on a real screen, or is it too subtle / too loud?

## The debug clock (2026-09-17)
Settings → DEBUG CLOCK. `nowDate()` is the app's only wall-clock read, so shifting it moves the
app's entire idea of "now" — date **and** time. **Anything logged while it's shifted is really
written to the shifted date**, so this is a real write path, not a preview.
- [x] The −1w / −1d / +1d / +1w buttons and NEXT MONDAY move the date, and the red banner appears.
      The banner is deliberately not dismissable.
- [x] The −1h / −15m / +15m / +1h buttons and the time field move the TIME independently, and the
      clock keeps *running* from wherever you put it (set 9pm, wait a minute, it reads 9:01pm).
      This is what makes "watch a scheduled activity pass" testable at all.
- [x] The shift and the banner survive backgrounding, force-closing and relaunching.
- [x] BACK TO THE REAL DATE & TIME clears everything, banner included.

## PROGRESS → BODY: weight and measurements merged (2026-09-17)
WEIGHT and MEASUREMENTS were two subtabs, two buttons, two forms for one act of stepping on a scale
with a tape in your hand. Now one BODY tab, one form, keyed by **date** — which is what retires the
old "replace today's entry?" prompt: a second entry on one day is no longer a shape you can create.
The bottom-bar tab is renamed **PROGRESS**.
- [x] Nothing logged today → **+ ADD ENTRY**; something logged → **Δ EDIT TODAY'S ENTRY**; it
      reverts on its own when the day turns (verify with the debug clock above).
- [x] Tapping **any** entry card — not just today's — opens it with its own numbers and its own date.
      Re-dating on save was a real bug: the save path used to read `#mDate`/`#wDate`, which don't
      exist on an edit form, and fell back to today.
- [x] Circumferences fold behind a DETAILED MEASUREMENTS disclosure, which opens itself when the
      day being edited actually has measurements. OTHER 1 / OTHER 2 sit after the calves.
- [x] Sleep, Quality and Resting HR are on this form **and** on Home, reading and writing the same
      daily-log entry — genuinely two-way, not a synced copy. Someone who never opens Home can still
      log sleep. (This was the call that mattered: a field you cannot reach is worse than a third store.)
- [ ] **Open flag (2026-09-17):** deleting a card currently clears only what the card shows — weight,
      measurements, sleep, quality, resting HR — leaving water/steps/stool. Field feedback says the
      entry should be the day's *whole* record: carry water/steps/stool on the form too and delete
      as one. Queued; re-check when it ships.

## Phases: the shelf and the popup editor (2026-09-17)
Adding a phase used to start it immediately, which made planning two blocks in a row impossible to
do calmly. A new phase now lands on `STATE.phaseShelf` instead. `phaseTimeline()` never sees the
shelf, so no date-chaining or projection code changed.
- [x] **+ ADD PHASE** does not start anything. It appears under NOT SCHEDULED.
- [x] With nothing deliberate running: **SAVE AND BEGIN** starts it today (replacing an unlogged
      placeholder outright rather than ending it mid-week — phases run in whole weeks).
- [x] With a real phase running, the same button reads **QUEUE NEXT** and schedules it to start the
      day the current one ends.
- [x] **SAVE FOR LATER** leaves it shelved, and that survives a relaunch.
- [ ] The editor is a **popup** now (2026-09-17). Nine phases got added unnoticed because each new
      card landed below the shelf and off-screen; a modal can't be scrolled away from.
- [ ] **Every field on a shelved phase commits** — rate %bw/wk, goal weight, label, weeks, rotation
      days, meal rotation. Fifteen mutators looked the phase up in `STATE.phases` only, so on a
      shelved phase all fifteen silently wrote nothing. They use `anyPhaseById()` now. If any field
      on a shelved phase refuses to stick, there is a sixteenth.

## Settings CLOSE stays red (2026-09-17)
- [ ] Settings → the **X CLOSE** in the bottom bar is red on every aesthetic — check Liminal, Space
      Highway, Hedge and Cartomancer especially. Greying the bar out in those four was written as
      `[data-aesthetic="x"] .tabbar button`, which **ties** `.tabbar button.tabbar-close` on
      specificity and wins on source order because `theme.css` loads after `styles.css`. A losing
      CSS rule renders a plausible-looking page and says nothing — `test_css_contract.js` now asserts
      CLOSE's computed colour across all 23 aesthetics so a new theme can't quietly repaint it.

## NetNavi voice (2026-09-17)
- [ ] **Vitalya's register, take two.** 💅 is retired — it read as a bit she was doing rather than a
      reaction she was having, which is the difference between the two halves of her brief. Her
      palette is now 🙄 unimpressed, 😬 wincing on your behalf, 😐 flat deadpan, and a long trailing
      "……" in the places where the funniest thing she can do is not finish the sentence. One line
      stays deliberately bare — "N habits broken. Absolutely not." — because it can share a box
      with the 😬 above it, and the same face twice reads as a tic. Read her on a real week.

## Notes rebuilt on the entry model — Phase 1 (2026-09-17)
`docs/NOTES_SPEC.md` Phase 1. `tests/test_notes.js` covers the migration, the Markdown renderer
(including six hostile-input cases), all four sorts, checkboxes, search and tag suggestions against
a synthetic old-shape save — **your real Notes data is the one fixture the sandbox never had**, and
this is the only migration in the app that can destroy something you personally wrote.
- [ ] **Every note you had is there**, with its own date, title, text and photos. Count them
      against what you remember before writing anything new.
- [ ] **Formatting survived the move from rich text to Markdown.** Bold, italic and both list
      kinds convert; **underline does not** — the spec's format set has no syntax for it, so those
      words are now plain. Check any note where underline carried meaning.
- [ ] **Your tags came across as their names**, lowercased. Notes that were on *General* now have
      no tag, because General meant "unfiled" rather than a label.
- [ ] **Your recipes are still recipes** — ingredients, servings and ADD TO MEALS all intact. They
      deliberately did NOT flatten into quick notes; that would have broken a working feature.
- [ ] The tag palette and Notes' own SETUP screen are **gone on purpose**. Colour is carried by the
      entry type now (six colours, one per type), which is what lifts the old twelve-tag cap.
- [ ] Delete a note: it goes, and the toast offers **UNDO** for a few seconds. Take it, and the
      note comes back whole.
- [ ] Type a checklist (`- [ ]`, or the ☐ Todo toolbar button), save, then tick items from the
      rendered view. Each tick saves immediately — force-close the app to prove it.
- [ ] Enter on a list line continues the list; Enter on an empty item ends it. This is the one
      editor behaviour that needs a real iOS keyboard to judge.
- [ ] The sort you pick is still there after a relaunch; the filter and search are deliberately not.
- [ ] Photos still attach, up to four, and open full-size.

## Notes Phase 5 — Meals & shopping (2026-09-17) — the rebuild is complete
`tests/test_recipe_match.js` covers the parser, all five statuses, the repairs, the remembered
mappings and the combining maths. What it can't judge is whether the matcher guesses *well* against
the foods you actually use, which is the only question left.
- [ ] Open a recipe with written ingredients and tap **⟳ MATCH WRITTEN INGREDIENTS TO FOODS**.
      Read the five rows: green is matched, amber wants an answer, red found nothing.
- [ ] **Does it parse your way of writing?** Try "1 1/2 tsp salt", "2.5 kg potatoes", "- 3 tbsp
      olive oil", "1 cup flour (plus more for dusting)". If a line you'd really write comes out
      wrong, tell me the line.
- [ ] Use each repair: **YES** on a "did you mean", **PICK…** for another food, **CREATE** for one
      that doesn't exist, an amount for a bare name, a unit for a mismatch, and **SKIP**.
- [ ] Save, then run the match **again** — everything you confirmed should now match with no
      prompts at all. That's the payoff for doing it once.
- [ ] A skipped ingredient shows on the recipe in an amber **"Not counted"** box, and rides along to
      the Meal. Confirm the macro totals visibly exclude it rather than pretending.
- [ ] **ADD 1 SERVING / ADD WHOLE BATCH** still work, and the resulting meal appears as a chip on
      the recipe.
- [ ] Edit the recipe afterwards: the chip should say **"recipe updated"** with **RE-IMPORT**.
      Nothing updates on its own — confirm that, then re-import and check the meal changed.
- [ ] **PHASES → MEAL PLAN → SHOPPING LIST → GENERATE** now offers two destinations. Try
      **SAVE AS A CHECKLIST NOTE**: it lands in Notes tagged `shopping`, linked to its recipes.
- [ ] Tick a few items off, then **⟳ UPDATE LIST**. Items still on the list keep their ticks — a
      half-done shop should stay half done.
- [ ] **Check the combining.** If two planned meals use the same food in different units, it should
      be one line with the amounts added. Different measures that can't convert (cups vs grams)
      stay separate on purpose.

## Notes Phase 4 — Convert (2026-09-17)
The type chip is a button now: tap it to turn a Quick note into a Journal, Writing, Travel, Recipe
or Hub — and back. `tests/test_entry_convert.js` checks every rule in the spec's table, every
type-to-type path, and that no line is ever lost. What it can't judge is whether the rules guess
*well* on your actual notes, which is the only question that matters here.
- [ ] Write a messy Quick note with a bit of everything — a numbered list, "2 cups flour", a
      bulleted line, "Serves 4", "Book the tickets", a URL, and some plain prose. Convert it to
      **Recipe**, then read the review screen. **Does the split match what you'd have done?**
- [ ] Convert the same note to **Travel** instead. Different rules apply — the numbered list and
      the flour should now be unsorted, the bullet should become packing.
- [ ] **UNSORTED is the thing to watch.** Anything no rule claimed lands there, and it stays on the
      entry in an amber box afterwards. Confirm nothing you wrote ever disappears.
- [ ] Use **MOVE** on a sorted line and **PLACE** on an unsorted one. BACK returns to the type
      choice without losing anything.
- [ ] **UNDO on the toast** puts the note back exactly as it was — type, body, every field.
- [ ] Convert a typed entry **back to Quick**: everything flattens into the body in field order.
- [ ] Convert something with **links in it to a Hub**: the linked lines become real members, and
      the rest of each line becomes that member's line of context.
- [ ] Empty template fields show as **"+ Add …"**, never as blank boxes. Tap one and type.
- [ ] **Recipes specifically:** converting must not disturb ingredients you'd already matched to
      real foods — check ADD TO MEALS still works and the macros are unchanged. The written list
      ("INGREDIENTS, AS WRITTEN") and the matched rows ("MATCHED INGREDIENTS") are two different
      things on purpose; Phase 5 is the bridge between them.
- [ ] **A judgement call:** are twelve fixed rules the right ones? If something consistently lands
      in the wrong place, tell me the line and where it should have gone — the rules are a table,
      and adding to it is cheap.

## Notes Phase 2 — Links (2026-09-17)
`tests/test_entry_links.js` is the spec's own acceptance list turned into assertions, including a
1,000-entry timing check. What it can't judge is the two real *gestures*, both of which need a
touchscreen and an on-screen keyboard.
- [ ] **Type `[[` in a note's body.** The suggestion list appears. Every word you type has to be in
      the title but the ORDER doesn't matter — "notes setup" should find "Setup notes". Tap one.
- [ ] **With the iOS keyboard up, is the suggestion list actually visible?** It sits under the
      textarea and gets scrolled into view; the keyboard is what makes this uncertain, and it's the
      single most likely thing to be wrong on a real phone. If it's hidden, say so and it moves
      above the textarea instead.
- [ ] Type `[[` and a name that doesn't exist, then pick **Create as a new note** — the note is
      made, the link works, and you stay in the note you were writing.
- [ ] Save a note whose `[[ ]]` names nothing: you're asked whether to create it, rather than the
      brackets silently staying in the prose.
- [ ] **Edit mode shows `[[Setup notes]]`, not `[[b7x9…]]`.** Rename the target, reopen: the link
      text follows the new name everywhere, in view AND in the editor.
- [ ] **Press and hold an inline link.** A card appears with the target's title and first sentence.
      Releasing must NOT navigate — it stays so you can read it. Tapping the card opens the target.
      Judge the hold duration (450ms): too twitchy, too slow, or about right?
- [ ] Follow a link, then the **back chevron** top-left returns you to where you came from.
- [ ] **LINKED FROM** shows the sentence each link sits in, and reads as prose — no raw `[[ ]]`.
- [ ] **UNLINKED MENTIONS**: write a note that names another by title without linking. It should be
      offered, and LINK IT should turn that text into a working link.
- [ ] Delete a note something links to: the link reads **"Deleted note"**, struck through. Undo
      from the toast and the link works again.

## Notes Phase 3 — Hubs (2026-09-17)
`tests/test_hubs.js` covers ordering, context lines, nesting, membership and deletion. What it
can't judge is whether the hub is a good way to work, which is the actual question here.
- [ ] **+ HUB** on the Notes list makes an empty hub and opens it. Give it a name and an intro —
      the body text IS the intro, there's no second field.
- [ ] **+ ADD ENTRY** gathers notes into it. The picker won't offer anything already in the hub,
      and won't offer the hub itself.
- [ ] **Move up / move down** reorder the list, and the arrows go dead at the ends rather than
      wrapping around. Force-close and relaunch — the order is still yours.
- [ ] Give a member a **line of context** ("Start here — diagnose before touching anything"). Open
      that note directly: the line shows under LINKED FROM beside the hub's name, marked IN HUB.
- [ ] Put the **same note in two hubs** and give it a different context line in each. They must not
      overwrite one another — the line belongs to the hub, not the note.
- [ ] **Remove a member.** The note itself must still exist in the list afterwards; this is the one
      place the difference between "remove" and "delete" really matters.
- [ ] **Put a hub inside a hub.** It should show with a square yellow dot, and tapping it goes in.
- [ ] **Delete a hub.** Its members all survive, and it disappears from their LINKED FROM.
- [ ] From any note, **+ ADD TO HUB** → pick an existing hub, or "NEW HUB WITH THIS IN IT".
- [ ] **A judgement call, not a bug:** reordering is buttons, not drag. Does that feel right on a
      phone, or is dragging worth building properly? (It would mean generalising Home's edit-mode
      drag, which is why it isn't here yet.)

## Stool & urine as tracked measurements (2026-09-17)
Both scales were already logged on Home; now the day's figures reach BODY and COMPARE.
`tests/test_bathroom.js` covers the maths, the local-day filing and the shared store.
- [ ] **PROGRESS → BODY**: a toilet button sits beside ADD/EDIT ENTRY, with a count badge. Tap it —
      **both** scales appear in one sheet.
- [ ] Tap a few shades on each. Every tap ADDS a reading (not a correction — that's Home's rule),
      each shows as a removable chip, and the running average and count are shown.
- [ ] The line at the bottom says what the day's two figures will be. Those are what reach the
      entry card and COMPARE — check the card underneath shows **Trips** and **Hydration**.
- [ ] Log a reading on **Home's PM strip** instead, then reopen this sheet: it should be there.
      There is one log, two ways in — if they ever disagree, that's the bug to report.
- [ ] **COMPARE → BODY** now offers Stool Consistency, Bathroom Trips, Hydration Colour and Urine
      Readings. Chart a couple of weeks and see whether the frequency line is actually useful when
      you change fibre — that's the question this was built for.
- [ ] Fill in **yesterday** from the sheet (open it from a past entry) and confirm the readings file
      under that day, not today.

## Add future items below as new features ship
