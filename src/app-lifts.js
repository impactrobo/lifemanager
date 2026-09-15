// app-lifts.js -- The lift library: one durable way to name a lift.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). Classic
// <script>; LIFT_LIBRARY is a top-level const, so this file must load before anything whose own
// const initializer reads it (nothing does today) -- see app-goals.js's header on load order.
//
// ---- Why this exists ----
// Nothing in the app could name a lift durably. GZCL's T1/T2 reference a categoryId (six of them),
// but T3 slots use FREE TEXT -- so a single workout style carried two identity schemes. Flat-list
// exercises have only a name and a uid() unique to that exercise in that workout.
//
// And an exercise id can never be the answer, because phases own plans: every new block builds a new
// plan with new uid()s, so a target pointing at an exercise id would break at EVERY block boundary --
// the exact thing the phases feature exists to make routine. Lift identity has to outlive the plan,
// by construction.
//
// A Lift is PURE IDENTITY: a name and a muscle. Nothing about programs, tiers or training maxes.
// "Bench" the lift and "Bench as a GZCL category with a T1 training max of 245" stay different
// things, which is why a category GAINS a liftId rather than being replaced by one.
//
// ---- Equipment leads the name ----
// Barbell Bench Press, Dumbbell Bench Press, Incline Barbell Bench Press. A bare "Bench Press" is
// exactly what shouldn't exist: those are three different lifts with three different loads and three
// different progressions, and collapsing them would corrupt all three histories at once. A shorter
// `short` rides along for log rows, so precision in the library costs nothing where space is tight.
//
// Names are free text and you can add your own -- the shipped list sets the pattern, and keeping a
// hand-added lift distinct is then yours to get right.

const LIFT_LIBRARY = [
  // ---- Chest ----
  { id: 'bb-bench', name: 'Barbell Bench Press', short: 'BB Bench', muscle: 'Chest' },
  { id: 'bb-incline-bench', name: 'Incline Barbell Bench Press', short: 'Inc BB Bench', muscle: 'Chest' },
  { id: 'bb-decline-bench', name: 'Decline Barbell Bench Press', short: 'Dec BB Bench', muscle: 'Chest' },
  { id: 'bb-close-grip-bench', name: 'Close-Grip Barbell Bench Press', short: 'CG Bench', muscle: 'Triceps' },
  { id: 'db-bench', name: 'Dumbbell Bench Press', short: 'DB Bench', muscle: 'Chest' },
  { id: 'db-incline-bench', name: 'Incline Dumbbell Bench Press', short: 'Inc DB Bench', muscle: 'Chest' },
  { id: 'db-flye', name: 'Dumbbell Flye', short: 'DB Flye', muscle: 'Chest' },
  { id: 'cable-flye', name: 'Cable Flye', short: 'Cable Flye', muscle: 'Chest' },
  { id: 'cable-crossover', name: 'Cable Crossover', short: 'Crossover', muscle: 'Chest' },
  { id: 'machine-chest-press', name: 'Machine Chest Press', short: 'Mach Press', muscle: 'Chest' },
  { id: 'pec-deck', name: 'Pec Deck', short: 'Pec Deck', muscle: 'Chest' },
  { id: 'push-up', name: 'Push-Up', short: 'Push-Up', muscle: 'Chest' },
  { id: 'dip-chest', name: 'Chest Dip', short: 'Chest Dip', muscle: 'Chest' },

  // ---- Back ----
  { id: 'bb-deadlift', name: 'Barbell Deadlift', short: 'Deadlift', muscle: 'Back' },
  { id: 'bb-sumo-deadlift', name: 'Sumo Barbell Deadlift', short: 'Sumo DL', muscle: 'Back' },
  { id: 'bb-rack-pull', name: 'Barbell Rack Pull', short: 'Rack Pull', muscle: 'Back' },
  { id: 'bb-row', name: 'Barbell Row', short: 'BB Row', muscle: 'Back' },
  { id: 'bb-pendlay-row', name: 'Pendlay Barbell Row', short: 'Pendlay Row', muscle: 'Back' },
  { id: 'db-row', name: 'Dumbbell Row', short: 'DB Row', muscle: 'Back' },
  { id: 'chest-supported-row', name: 'Chest-Supported Dumbbell Row', short: 'CS Row', muscle: 'Back' },
  { id: 'tbar-row', name: 'T-Bar Row', short: 'T-Bar Row', muscle: 'Back' },
  { id: 'cable-seated-row', name: 'Seated Cable Row', short: 'Cable Row', muscle: 'Back' },
  { id: 'lat-pulldown', name: 'Lat Pulldown', short: 'Pulldown', muscle: 'Back' },
  { id: 'cable-straight-arm-pulldown', name: 'Straight-Arm Cable Pulldown', short: 'SA Pulldown', muscle: 'Back' },
  { id: 'pull-up', name: 'Pull-Up', short: 'Pull-Up', muscle: 'Back' },
  { id: 'chin-up', name: 'Chin-Up', short: 'Chin-Up', muscle: 'Back' },
  { id: 'machine-row', name: 'Machine Row', short: 'Mach Row', muscle: 'Back' },

  // ---- Quads ----
  { id: 'bb-back-squat', name: 'Barbell Back Squat', short: 'Back Squat', muscle: 'Quads' },
  { id: 'bb-front-squat', name: 'Barbell Front Squat', short: 'Front Squat', muscle: 'Quads' },
  { id: 'bb-pause-squat', name: 'Paused Barbell Back Squat', short: 'Pause Squat', muscle: 'Quads' },
  { id: 'safety-bar-squat', name: 'Safety Bar Squat', short: 'SSB Squat', muscle: 'Quads' },
  { id: 'hack-squat', name: 'Hack Squat', short: 'Hack Squat', muscle: 'Quads' },
  { id: 'leg-press', name: 'Leg Press', short: 'Leg Press', muscle: 'Quads' },
  { id: 'db-bulgarian-split-squat', name: 'Dumbbell Bulgarian Split Squat', short: 'BSS', muscle: 'Quads' },
  { id: 'db-walking-lunge', name: 'Dumbbell Walking Lunge', short: 'DB Lunge', muscle: 'Quads' },
  { id: 'db-goblet-squat', name: 'Goblet Squat', short: 'Goblet Squat', muscle: 'Quads' },
  { id: 'leg-extension', name: 'Leg Extension', short: 'Leg Ext', muscle: 'Quads' },
  { id: 'db-step-up', name: 'Dumbbell Step-Up', short: 'Step-Up', muscle: 'Quads' },

  // ---- Hams ----
  { id: 'bb-romanian-deadlift', name: 'Barbell Romanian Deadlift', short: 'BB RDL', muscle: 'Hams' },
  { id: 'db-romanian-deadlift', name: 'Dumbbell Romanian Deadlift', short: 'DB RDL', muscle: 'Hams' },
  { id: 'bb-stiff-leg-deadlift', name: 'Stiff-Leg Barbell Deadlift', short: 'SLDL', muscle: 'Hams' },
  { id: 'lying-leg-curl', name: 'Lying Leg Curl', short: 'Lying Curl', muscle: 'Hams' },
  { id: 'seated-leg-curl', name: 'Seated Leg Curl', short: 'Seated Curl', muscle: 'Hams' },
  { id: 'nordic-curl', name: 'Nordic Hamstring Curl', short: 'Nordic', muscle: 'Hams' },
  { id: 'back-extension', name: 'Back Extension', short: 'Back Ext', muscle: 'Hams' },
  { id: 'good-morning', name: 'Barbell Good Morning', short: 'Good Morning', muscle: 'Hams' },

  // ---- Glutes ----
  { id: 'bb-hip-thrust', name: 'Barbell Hip Thrust', short: 'Hip Thrust', muscle: 'Glutes' },
  { id: 'glute-bridge', name: 'Barbell Glute Bridge', short: 'Glute Bridge', muscle: 'Glutes' },
  { id: 'cable-kickback', name: 'Cable Glute Kickback', short: 'Kickback', muscle: 'Glutes' },
  { id: 'hip-abduction', name: 'Machine Hip Abduction', short: 'Abduction', muscle: 'Glutes' },
  { id: 'db-reverse-lunge', name: 'Dumbbell Reverse Lunge', short: 'Rev Lunge', muscle: 'Glutes' },
  { id: 'db-sumo-deadlift-glute', name: 'Dumbbell Sumo Deadlift', short: 'DB Sumo', muscle: 'Glutes' },

  // ---- S Delts (side/lateral) ----
  { id: 'db-lateral-raise', name: 'Dumbbell Lateral Raise', short: 'Lat Raise', muscle: 'S Delts' },
  { id: 'cable-lateral-raise', name: 'Cable Lateral Raise', short: 'Cable Lat Raise', muscle: 'S Delts' },
  { id: 'machine-lateral-raise', name: 'Machine Lateral Raise', short: 'Mach Lat Raise', muscle: 'S Delts' },
  { id: 'bb-upright-row', name: 'Barbell Upright Row', short: 'Upright Row', muscle: 'S Delts' },

  // ---- F Delts (front) ----
  { id: 'bb-overhead-press', name: 'Barbell Overhead Press', short: 'OHP', muscle: 'F Delts' },
  { id: 'bb-push-press', name: 'Barbell Push Press', short: 'Push Press', muscle: 'F Delts' },
  { id: 'db-shoulder-press', name: 'Dumbbell Shoulder Press', short: 'DB Press', muscle: 'F Delts' },
  { id: 'db-arnold-press', name: 'Arnold Press', short: 'Arnold', muscle: 'F Delts' },
  { id: 'machine-shoulder-press', name: 'Machine Shoulder Press', short: 'Mach OHP', muscle: 'F Delts' },
  { id: 'db-front-raise', name: 'Dumbbell Front Raise', short: 'Front Raise', muscle: 'F Delts' },

  // ---- R Delts (rear) ----
  { id: 'db-rear-delt-flye', name: 'Dumbbell Rear Delt Flye', short: 'Rear Flye', muscle: 'R Delts' },
  { id: 'cable-face-pull', name: 'Cable Face Pull', short: 'Face Pull', muscle: 'R Delts' },
  { id: 'reverse-pec-deck', name: 'Reverse Pec Deck', short: 'Rev Pec Deck', muscle: 'R Delts' },
  { id: 'cable-rear-delt-flye', name: 'Cable Rear Delt Flye', short: 'Cable Rear Flye', muscle: 'R Delts' },

  // ---- Traps ----
  { id: 'bb-shrug', name: 'Barbell Shrug', short: 'BB Shrug', muscle: 'Traps' },
  { id: 'db-shrug', name: 'Dumbbell Shrug', short: 'DB Shrug', muscle: 'Traps' },
  { id: 'trap-bar-shrug', name: 'Trap Bar Shrug', short: 'TB Shrug', muscle: 'Traps' },
  { id: 'farmers-carry', name: "Farmer's Carry", short: "Farmer's", muscle: 'Traps' },

  // ---- Biceps ----
  { id: 'bb-curl', name: 'Barbell Curl', short: 'BB Curl', muscle: 'Biceps' },
  { id: 'ez-bar-curl', name: 'EZ-Bar Curl', short: 'EZ Curl', muscle: 'Biceps' },
  { id: 'db-curl', name: 'Dumbbell Curl', short: 'DB Curl', muscle: 'Biceps' },
  { id: 'db-incline-curl', name: 'Incline Dumbbell Curl', short: 'Inc Curl', muscle: 'Biceps' },
  { id: 'db-hammer-curl', name: 'Dumbbell Hammer Curl', short: 'Hammer Curl', muscle: 'Biceps' },
  { id: 'cable-curl', name: 'Cable Curl', short: 'Cable Curl', muscle: 'Biceps' },
  { id: 'preacher-curl', name: 'Preacher Curl', short: 'Preacher', muscle: 'Biceps' },
  { id: 'db-concentration-curl', name: 'Concentration Curl', short: 'Conc Curl', muscle: 'Biceps' },

  // ---- Triceps ----
  { id: 'cable-pushdown', name: 'Cable Triceps Pushdown', short: 'Pushdown', muscle: 'Triceps' },
  { id: 'cable-rope-pushdown', name: 'Rope Triceps Pushdown', short: 'Rope Pushdown', muscle: 'Triceps' },
  { id: 'cable-overhead-extension', name: 'Overhead Cable Triceps Extension', short: 'OH Ext', muscle: 'Triceps' },
  { id: 'db-skullcrusher', name: 'Dumbbell Skullcrusher', short: 'DB Skulls', muscle: 'Triceps' },
  { id: 'ez-skullcrusher', name: 'EZ-Bar Skullcrusher', short: 'EZ Skulls', muscle: 'Triceps' },
  { id: 'dip-triceps', name: 'Triceps Dip', short: 'Tri Dip', muscle: 'Triceps' },
  { id: 'db-kickback', name: 'Dumbbell Triceps Kickback', short: 'Tri Kickback', muscle: 'Triceps' },

  // ---- Forearms ----
  { id: 'bb-wrist-curl', name: 'Barbell Wrist Curl', short: 'Wrist Curl', muscle: 'Forearms' },
  { id: 'bb-reverse-curl', name: 'Barbell Reverse Curl', short: 'Rev Curl', muscle: 'Forearms' },
  { id: 'dead-hang', name: 'Dead Hang', short: 'Dead Hang', muscle: 'Forearms' },
  { id: 'wrist-roller', name: 'Wrist Roller', short: 'Wrist Roller', muscle: 'Forearms' },

  // ---- Calves ----
  { id: 'standing-calf-raise', name: 'Standing Calf Raise', short: 'Std Calf', muscle: 'Calves' },
  { id: 'seated-calf-raise', name: 'Seated Calf Raise', short: 'Seated Calf', muscle: 'Calves' },
  { id: 'leg-press-calf-raise', name: 'Leg Press Calf Raise', short: 'LP Calf', muscle: 'Calves' },

  // ---- Abs ----
  { id: 'cable-crunch', name: 'Cable Crunch', short: 'Cable Crunch', muscle: 'Abs' },
  { id: 'hanging-leg-raise', name: 'Hanging Leg Raise', short: 'Hang Leg Raise', muscle: 'Abs' },
  { id: 'plank', name: 'Plank', short: 'Plank', muscle: 'Abs' },
  { id: 'ab-wheel', name: 'Ab Wheel Rollout', short: 'Ab Wheel', muscle: 'Abs' },
  { id: 'decline-sit-up', name: 'Decline Sit-Up', short: 'Decline Sit-Up', muscle: 'Abs' },
  { id: 'pallof-press', name: 'Cable Pallof Press', short: 'Pallof', muscle: 'Abs' },
  { id: 'machine-crunch', name: 'Machine Crunch', short: 'Mach Crunch', muscle: 'Abs' },

  // ---- Neck ----
  { id: 'neck-harness-extension', name: 'Neck Harness Extension', short: 'Neck Ext', muscle: 'Neck' },
  { id: 'neck-curl', name: 'Plate Neck Curl', short: 'Neck Curl', muscle: 'Neck' },
];

// Shipped list first, then anything added by hand. Concatenated rather than merged into STATE on
// load: the shipped list can grow between releases without a migration, and a hand-added lift can
// never be silently replaced by a later shipped one with the same id, because ids are slugs the
// library owns and uid()s are what added lifts get.
function allLifts() { return LIFT_LIBRARY.concat(Array.isArray(STATE.lifts) ? STATE.lifts : []); }
function liftById(id) { return id ? (allLifts().find(l => l.id === id) || null) : null; }
function liftsByMuscle(muscle) { return allLifts().filter(l => l.muscle === muscle); }
// Falls back to whatever the thing already called itself, so a workout with no liftId yet still
// renders its own name rather than a blank or an id.
function liftName(id, fallback) { const l = liftById(id); return l ? l.name : (fallback || ''); }
function liftShort(id, fallback) { const l = liftById(id); return l ? (l.short || l.name) : (fallback || ''); }
function liftIsCustom(id) { return !!(Array.isArray(STATE.lifts) && STATE.lifts.some(l => l.id === id)); }

function addCustomLift(name, muscle, short) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const lift = { id: uid(), name: trimmed, short: (short || '').trim() || trimmed, muscle: muscle || null };
  if (!Array.isArray(STATE.lifts)) STATE.lifts = [];
  STATE.lifts.push(lift);
  return lift;
}

// ---- "Did you mean" ----
//
// Fuzzy matching earns its place HERE and nowhere near the code that actually assigns a lift. It
// generates candidates for a person to choose between; a wrong automatic merge fuses two lifts'
// histories permanently, while a wrong suggestion costs a glance.
//
// Scored on shared words rather than edit distance, because the failure this has to handle is a
// missing qualifier ("Bench Press" vs "Barbell Bench Press"), not a typo. Edit distance would rank
// "Bench Press" closest to itself-plus-one-word and bury the three real candidates behind it.
function liftNameWords(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
}
function liftSuggestions(name, limit) {
  const want = liftNameWords(name);
  if (!want.length) return [];
  return allLifts()
    .map(l => {
      const have = liftNameWords(l.name);
      const shared = want.filter(w => have.includes(w)).length;
      // Every wanted word present is a strong signal even when the library name adds qualifiers --
      // which is exactly the "Bench Press" -> "Barbell Bench Press" case.
      const coverage = shared / want.length;
      return { lift: l, score: coverage * 2 + shared / Math.max(have.length, 1) };
    })
    .filter(x => x.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit || 3)
    .map(x => x.lift);
}
// An EXACT name match, case- and space-insensitive. The only automatic assignment there is, because
// it isn't a guess.
function liftByExactName(name) {
  const key = liftNameWords(name).join(' ');
  if (!key) return null;
  return allLifts().find(l => liftNameWords(l.name).join(' ') === key) || null;
}

// ---- Everything still naming a lift by free text ----
//
// Deliberately a REVIEW list rather than a migration that runs on load. Assigning these is a
// judgement call with permanent consequences, so the app gathers them and waits.
function unlinkedLiftRefs() {
  const out = [];
  (STATE.categories || []).forEach(c => {
    if (!c.liftId) out.push({ kind: 'category', id: c.id, name: c.name, muscle: (c.tiers && c.tiers.muscle) || null, label: 'GZCL category' });
  });
  (STATE.workouts || []).forEach(w => {
    (w.exercises || []).forEach(ex => {
      if (ex.name && !ex.liftId) out.push({ kind: 'exercise', id: ex.id, workoutId: w.id, name: ex.name, muscle: ex.muscle || null, label: w.name });
    });
    (w.t3 || []).forEach((slot, idx) => {
      if (slot.name && !slot.liftId) out.push({ kind: 't3', id: String(idx), workoutId: w.id, name: slot.name, muscle: slot.muscle || null, label: w.name + ' · T3' });
    });
  });
  return out;
}

function assignLiftRef(ref, liftId) {
  const lift = liftById(liftId);
  if (!lift) return;
  if (ref.kind === 'category') {
    const c = (STATE.categories || []).find(x => x.id === ref.id);
    if (c) c.liftId = liftId;
  } else {
    const w = (STATE.workouts || []).find(x => x.id === ref.workoutId);
    if (!w) return;
    if (ref.kind === 'exercise') {
      const ex = (w.exercises || []).find(x => x.id === ref.id);
      // The name follows the lift, so the two can't drift apart afterwards. The lift is the identity
      // now; leaving a stale free-text name beside it is how you end up with two answers again.
      if (ex) { ex.liftId = liftId; ex.name = lift.name; if (lift.muscle) ex.muscle = lift.muscle; }
    } else if (ref.kind === 't3') {
      const slot = (w.t3 || [])[Number(ref.id)];
      if (slot) { slot.liftId = liftId; slot.name = lift.name; if (lift.muscle) slot.muscle = lift.muscle; }
    }
  }
}

// ---- The muscle-first picker ----
//
// Muscle group first, then the lift. Choosing Chest and seeing a dozen options beats scrolling a
// list of two hundred, and muscle alone makes the list short enough that no second filter is worth
// the extra tap. Rendered inline where it's used rather than as a modal, so the thing you're naming
// stays on screen beside it.
function openLiftPicker(token, currentLiftId) {
  UI.liftPicker = { token, muscle: (liftById(currentLiftId) || {}).muscle || null, query: '' };
  render();
}
function closeLiftPicker() { UI.liftPicker = null; render(); }
function setLiftPickerMuscle(m) { if (UI.liftPicker) { UI.liftPicker.muscle = m || null; render(); } }
function setLiftPickerQuery(q) { if (UI.liftPicker) { UI.liftPicker.query = q; render(); } }

// `token` identifies what's being named. The picker doesn't know or care what that is -- it routes
// back through onPickLift(token, liftId), which parses the token and calls the right setter. That
// keeps one picker serving categories, flat exercises, T3 slots and the review screen without any of
// them knowing about each other.
function renderLiftPicker(token, currentLiftId) {
  const open = UI.liftPicker && UI.liftPicker.token === token;
  const cur = liftById(currentLiftId);
  if (!open) {
    return `<button class="btn btn-sm btn-block lift-pick-btn" onclick="openLiftPicker('${token}','${currentLiftId || ''}')">
      ${cur ? escapeHtml(cur.name) : '+ CHOOSE A LIFT'}
    </button>`;
  }
  const p = UI.liftPicker;
  const q = (p.query || '').trim();
  // A search box spanning every muscle, for when you know the name and don't want two taps. It
  // narrows the same list the muscle chips do; it never creates anything.
  const list = q ? allLifts().filter(l => liftNameWords(l.name).join(' ').indexOf(liftNameWords(q).join(' ')) >= 0)
                 : (p.muscle ? liftsByMuscle(p.muscle) : []);
  return `
    <div class="lift-picker">
      <div class="row" style="margin-bottom:8px;">
        <span class="subtle-label" style="margin-bottom:0;">CHOOSE A LIFT</span>
        <button class="btn btn-sm btn-ghost" onclick="closeLiftPicker()">CLOSE</button>
      </div>
      <input type="text" placeholder="Search all lifts…" value="${escapeHtml(p.query || '')}"
             oninput="setLiftPickerQuery(this.value)" style="margin-bottom:8px;">
      ${q ? '' : `
        <div class="lift-muscles">
          ${MUSCLE_GROUPS.map(m => `
            <button class="btn btn-sm ${p.muscle === m ? 'btn-primary' : ''}" onclick="setLiftPickerMuscle('${m}')">${m}</button>`).join('')}
        </div>`}
      ${list.length ? `
        <div class="lift-list">
          ${list.map(l => `
            <button class="lift-row ${l.id === currentLiftId ? 'lift-row-current' : ''}" onclick="onPickLift('${token}','${l.id}')">
              <span class="lift-row-name">${escapeHtml(l.name)}</span>
              <span class="lift-row-short">${escapeHtml(l.short || '')}</span>
            </button>`).join('')}
        </div>`
        : `<div style="font-size:11px; color:var(--text-faint); padding:6px 0;">
             ${q ? 'No lift matches that. Add it below if it’s missing.' : 'Pick a muscle group to see its lifts.'}
           </div>`}
      <div class="lift-add">
        <div class="subtle-label" style="margin:10px 0 6px;">NOT IN THE LIST?</div>
        <div style="font-size:11px; color:var(--text-faint); margin-bottom:8px; line-height:1.5;">
          Lead with the equipment — <b style="color:var(--text)">Barbell</b> Bench Press, not Bench Press.
          Three different loads and three different progressions live under that one bare name.
        </div>
        <input type="text" id="newLiftName_${token}" placeholder="e.g. Landmine Press" style="margin-bottom:6px;">
        <div class="field-row" style="align-items:flex-end;">
          <label class="field" style="margin-bottom:0;"><span class="lbl">Short form</span>
            <input type="text" id="newLiftShort_${token}" placeholder="optional"></label>
          <label class="field" style="margin-bottom:0;"><span class="lbl">Muscle</span>
            <select id="newLiftMuscle_${token}">
              ${MUSCLE_GROUPS.map(m => `<option value="${m}"${m === p.muscle ? ' selected' : ''}>${m}</option>`).join('')}
            </select></label>
        </div>
        <button class="btn btn-sm btn-block" style="margin-top:8px;" onclick="createLiftFromPicker('${token}')">ADD THIS LIFT</button>
      </div>
    </div>`;
}

// The compact form used inline in the Workout Builder: one line showing what this is linked to, or
// a prompt if it isn't, expanding into the full picker in place. The exercise's own name field stays
// right above it -- linking sets the name from the lift, so the two can't drift apart afterwards.
function renderLiftLink(token, liftId) {
  const open = UI.liftPicker && UI.liftPicker.token === token;
  if (open) return `<div style="margin-bottom:8px;">${renderLiftPicker(token, liftId)}</div>`;
  const lift = liftById(liftId);
  return `
    <button class="lift-link ${lift ? 'lift-link-set' : ''}" onclick="openLiftPicker('${token}','${liftId || ''}')">
      <span class="lift-link-k">LIFT</span>
      <span class="lift-link-v">${lift ? escapeHtml(lift.name) : 'not linked — tap to choose'}</span>
      ${lift && lift.short && lift.short !== lift.name ? `<span class="lift-link-short">${escapeHtml(lift.short)}</span>` : ''}
    </button>`;
}

function createLiftFromPicker(token) {
  const name = inputVal('newLiftName_' + token);
  if (!(name || '').trim()) { showToast('Give the lift a name'); return; }
  const existing = liftByExactName(name);
  // An exact name match is not a guess, so reusing it is safe -- and it stops the library filling up
  // with duplicates of itself.
  if (existing) { showToast('That lift already exists — using it'); onPickLift(token, existing.id); return; }
  const lift = addCustomLift(name, inputVal('newLiftMuscle_' + token), inputVal('newLiftShort_' + token));
  if (lift) onPickLift(token, lift.id);
}

// The one routing point. A token is "<kind>:<args>", parsed here so no caller has to.
function onPickLift(token, liftId) {
  const parts = String(token).split(':');
  const kind = parts[0];
  if (kind === 'cat') {
    const c = (STATE.categories || []).find(x => x.id === parts[1]);
    if (c) c.liftId = liftId;
  } else if (kind === 'ex') {
    assignLiftRef({ kind: 'exercise', workoutId: parts[1], id: parts[2] }, liftId);
  } else if (kind === 't3') {
    assignLiftRef({ kind: 't3', workoutId: parts[1], id: parts[2] }, liftId);
  } else if (kind === 'extarget') {
    const t = (STATE.exTargets || []).find(x => x.id === parts[1]);
    if (t) t.liftId = liftId;
  } else if (kind === 'review') {
    assignLiftRef({ kind: parts[1], id: parts[2], workoutId: parts[3] || null }, liftId);
  }
  UI.liftPicker = null;
  saveState();
  render();
}

// ---- The review screen ----
//
// Never runs on its own. An existing exercise whose name doesn't match a library lift EXACTLY is
// offered as a new lift, with near-matches beside it as suggestions -- "Bench Press: did you mean
// Barbell Bench Press? Dumbbell Bench Press?" A wrong automatic merge fuses two lifts' histories
// permanently; a wrong suggestion costs a glance.
function renderLiftReview() {
  const refs = unlinkedLiftRefs();
  const customCount = Array.isArray(STATE.lifts) ? STATE.lifts.length : 0;
  return `
    <div style="font-size:11px; color:var(--text-dim); margin:14px 0; line-height:1.6;">
      A lift is pure identity — a name and a muscle — and it outlives any plan that uses it. That's
      the point: a block's exercise ids change every time you start a new one, so a target or a PR
      can't hang off them. <b style="color:var(--text)">${LIFT_LIBRARY.length}</b> lifts ship in the
      library${customCount ? `, plus <b style="color:var(--text)">${customCount}</b> you added` : ''}.
    </div>
    ${refs.length ? `
      <div class="subtle-label" style="margin:18px 0 8px;">STILL NAMED BY FREE TEXT (${refs.length})</div>
      <div style="font-size:11px; color:var(--text-faint); margin-bottom:10px; line-height:1.6;">
        <b style="color:var(--text)">Nothing here is linked automatically</b> unless the name matches a
        library lift exactly. A wrong merge would fuse two lifts' histories permanently.
      </div>
      <div class="stack">
        ${refs.map(r => {
          const token = `review:${r.kind}:${r.id}:${r.workoutId || ''}`;
          const exact = liftByExactName(r.name);
          const sugg = exact ? [] : liftSuggestions(r.name, 3);
          return `
            <div class="panel">
              <div class="ehead">
                <div style="font-weight:700; font-size:14px;">${escapeHtml(r.name)}</div>
                ${r.muscle ? `<span class="lift-muscle-chip" style="background:${muscleColor(r.muscle) || 'var(--surface2)'};">${r.muscle}</span>` : ''}
              </div>
              <div style="font-size:11px; color:var(--text-faint); margin-bottom:8px;">${escapeHtml(r.label)}</div>
              ${exact
                ? `<button class="btn btn-sm btn-good btn-block" onclick="onPickLift('${token}','${exact.id}')">LINK TO ${escapeHtml(exact.name)}</button>
                   <div style="font-size:11px; color:var(--text-faint); margin-top:5px;">Exact name match — not a guess.</div>`
                : `${sugg.length ? `
                     <div style="font-size:11px; color:var(--text-faint); margin-bottom:6px;">Did you mean…</div>
                     <div class="stack" style="margin-bottom:8px;">
                       ${sugg.map(l => `<button class="btn btn-sm btn-block" onclick="onPickLift('${token}','${l.id}')">${escapeHtml(l.name)}</button>`).join('')}
                     </div>` : ''}
                   ${renderLiftPicker(token, null)}`}
            </div>`;
        }).join('')}
      </div>`
      : emptyState('Every exercise is linked to a lift. Nothing to review.')}`;
}

// ---- bestForLift(): the resolver targets and the PR log both needed ----
//
// "Exercise PR log" sat on the backlog unbuilt, and it is this feature seen from the other side: a
// PR log asks "when did I hit a new best?", a target asks "how far am I from a best I've named?"
// Both need the same missing thing, so it's built once.
//
// Mapping a LOG ENTRY back to a lift is the whole job, and it differs by workout shape:
//   GZCL T1/T2  entry key is the tier -> workout[tier].categoryId -> that category's liftId
//   GZCL T3     entry key is 't3_<i>' -> workout.t3[i].liftId
//   flat list   entry key IS the exercise id -> that exercise's liftId
// Walking every log once and asking each entry which lift it was is cheaper, and far less fragile,
// than four call sites each re-deriving it.
function liftIdForLogEntry(workout, entryKey) {
  if (!workout) return null;
  if (entryKey.indexOf('t3_') === 0) {
    const slot = (workout.t3 || [])[Number(entryKey.split('_')[1])];
    return (slot && slot.liftId) || null;
  }
  if (entryKey === 't1' || entryKey === 'ultra' || entryKey === 't2a' || entryKey === 't2b' || entryKey === 't2c') {
    const tier = workout[entryKey === 'ultra' ? 't1' : entryKey];
    const cat = tier && tier.categoryId ? getCategory(tier.categoryId) : null;
    return (cat && cat.liftId) || null;
  }
  const ex = (workout.exercises || []).find(e => e.id === entryKey);
  return (ex && ex.liftId) || null;
}

// Every set ever logged for a lift, newest first. `since` bounds it -- a goal is about what you do
// DURING it, so a 225 from two years ago doesn't complete one set today.
//
// Deload sets are excluded. They're deliberately reduced work, so counting one toward a personal
// best would be as wrong as letting it become a progression base -- the same reasoning
// progressionLogFor() exists for, applied to a different question.
function liftSetHistory(liftId, since) {
  if (!liftId) return [];
  const out = [];
  Object.keys(STATE.logs).forEach(k => {
    const log = STATE.logs[k];
    if (!log || !log.date || logIsDeload(log)) return;
    if (since && log.date < since) return;
    const workoutId = k.slice(k.indexOf('_') + 1);
    const workout = getWorkout(workoutId);
    if (!workout) return;
    Object.keys(log.entries || {}).forEach(entryKey => {
      if (liftIdForLogEntry(workout, entryKey) !== liftId) return;
      (log.entries[entryKey].sets || []).forEach(s => {
        const weightLb = Number(s.weight), reps = Number(s.reps);
        if (!isFinite(weightLb) || !isFinite(reps) || weightLb <= 0 || reps <= 0) return;
        out.push({ date: log.date, weightLb, reps, workoutId, workoutName: workout.name });
      });
    });
  });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// The best set for a lift, by two different definitions of "best" -- because "I want 225 on the bar"
// and "I want to own 225 for five" are different ambitions, and one number can't answer both.
//
// `heaviest` is the top weight at any rep count. `bestAtReps(n)` is the top weight moved for AT
// LEAST n reps, which is what a rep-max target needs.
function bestForLift(liftId, since) {
  const sets = liftSetHistory(liftId, since);
  if (!sets.length) return null;
  let heaviest = null, mostReps = null;
  sets.forEach(s => {
    if (!heaviest || s.weightLb > heaviest.weightLb) heaviest = s;
    if (!mostReps || s.reps > mostReps.reps) mostReps = s;
  });
  return {
    sets,
    heaviest,
    mostReps,
    lastDate: sets[0].date,
    sessions: new Set(sets.map(s => s.date)).size,
    // The heaviest set that also hit at least `reps`. Null when nothing has.
    bestAtReps: (reps) => sets.reduce((best, s) =>
      (s.reps >= reps && (!best || s.weightLb > best.weightLb)) ? s : best, null),
  };
}

// Cardio has no identity problem to solve -- a run is a run -- so these read every cardio log rather
// than resolving a lift. Interval-style cardio tracks rounds, not distance, and simply contributes
// nothing here.
function cardioSessionsInRange(since, until) {
  const out = [];
  const cardioIds = new Set(workoutsByType('cardio').map(w => w.id));
  Object.keys(STATE.logs).forEach(k => {
    const workoutId = k.slice(k.indexOf('_') + 1);
    if (!cardioIds.has(workoutId)) return;
    const log = STATE.logs[k];
    if (!log || !log.date) return;
    if (since && log.date < since) return;
    if (until && log.date > until) return;
    out.push({
      date: log.date, workoutId,
      minutes: Number(log.actualMinutes) || 0,
      distance: Number(log.actualDistance) || 0,
      unit: (getWorkout(workoutId) || {}).targetDistanceUnit || 'mi',
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Exercise targets ----
//
// Four types. 1RM and Rep Max borrow vocabulary the app already speaks -- TEST_CONV_MAP has carried
// 1RM/5RM/10RM for training-max work all along. Keeping them as two NAMED types rather than one
// weight x reps field is what makes the intent legible.
//
// Three of the four are personal bests: monotonic, achieved the moment you touch them. Total volume
// is cumulative and window-bounded -- meaningful only inside the goal, always climbing, reset by the
// next one. Worth not rendering all four as the same bar.
const EX_TARGET_TYPES = [
  { key: '1rm', label: '1RM', needs: ['lift', 'weight'], cumulative: false },
  { key: 'repMax', label: 'Rep max', needs: ['lift', 'weight', 'reps'], cumulative: false },
  { key: 'cardioTime', label: 'Time for a distance', needs: ['distance', 'minutes'], cumulative: false },
  { key: 'cardioVolume', label: 'Total distance', needs: ['distance'], cumulative: true },
];
function exTargetType(key) { return EX_TARGET_TYPES.find(t => t.key === key) || EX_TARGET_TYPES[0]; }

function exerciseTargets(goalId) { return (STATE.exTargets || []).filter(t => t.goalId === goalId); }

// Where a target stands: current, target, gap. Deliberately NO projection -- weight loss is roughly
// linear against a deficit, which is what makes projecting it defensible, but strength and cardio
// move in steps and stalls. A straight line through them would be confidently wrong most of the
// time, and that is worse than saying nothing.
function exTargetProgress(target, goal) {
  const since = goal ? goal.startDate : null;
  const type = exTargetType(target.kind);
  const out = { target, type, since, reached: false, current: null, currentLabel: '—', targetLabel: '', gapLabel: null, lifetime: null, pct: 0 };

  if (type.key === '1rm' || type.key === 'repMax') {
    const want = Number(target.weightLb) || 0;
    const reps = type.key === 'repMax' ? (Number(target.reps) || 1) : 1;
    out.targetLabel = `${fmt(lbToDisplay(want), 1)} ${weightUnitLabel()}${type.key === 'repMax' ? ` × ${reps}` : ''}`;
    const best = bestForLift(target.liftId, since);
    const hit = best && best.bestAtReps(reps);
    // 245 x 3 does NOT satisfy 225 x 5. Forced by ruling out e1RM: with no formula you can't compare
    // across rep ranges, so a set must meet or exceed BOTH numbers. Conservative, and never wrong in
    // the direction that matters.
    if (hit) {
      out.current = hit.weightLb;
      // A 1RM target asks "is that weight on the bar?", so the rep count isn't part of the answer --
      // printing it would read as a rep max and blur the distinction the two types exist to keep.
      out.currentLabel = type.key === '1rm'
        ? `${fmt(lbToDisplay(hit.weightLb), 1)} ${weightUnitLabel()}`
        : `${fmt(lbToDisplay(hit.weightLb), 1)} ${weightUnitLabel()} × ${hit.reps}`;
      out.reached = hit.weightLb >= want;
      out.pct = Math.max(0, Math.min(100, (hit.weightLb / want) * 100));
      if (!out.reached) out.gapLabel = `${fmt(lbToDisplay(want - hit.weightLb), 1)} ${weightUnitLabel()} to go`;
      out.currentDate = hit.date;
    } else {
      out.currentLabel = best ? `nothing at × ${reps} yet` : 'not logged yet';
    }
    // The lifetime best sits alongside as context -- useful precisely when the goal IS getting back
    // to something you've done before.
    const life = bestForLift(target.liftId, null);
    const lifeHit = life && life.bestAtReps(reps);
    if (lifeHit && (!hit || lifeHit.weightLb > hit.weightLb)) {
      out.lifetime = `${fmt(lbToDisplay(lifeHit.weightLb), 1)} ${weightUnitLabel()} × ${lifeHit.reps} on ${fmtGoalDate(lifeHit.date)}`;
    }
    return out;
  }

  if (type.key === 'cardioTime') {
    const dist = Number(target.distance) || 0;
    const mins = Number(target.minutes) || 0;
    out.targetLabel = `${fmt(dist, 2)} ${target.unit || 'mi'} in ${fmtMinutes(mins)}`;
    // Lowest minutes on ANY session that actually covered the distance. A session that fell short
    // can't count however fast it was.
    const qualifying = cardioSessionsInRange(since, null).filter(s => s.distance >= dist && s.minutes > 0);
    if (qualifying.length) {
      const best = qualifying.reduce((b, s) => (!b || s.minutes < b.minutes) ? s : b, null);
      out.current = best.minutes;
      out.currentLabel = fmtMinutes(best.minutes);
      out.reached = best.minutes <= mins;
      out.pct = Math.max(0, Math.min(100, (mins / best.minutes) * 100));
      if (!out.reached) out.gapLabel = `${fmtMinutes(best.minutes - mins)} faster to go`;
      out.currentDate = best.date;
    } else {
      out.currentLabel = `nothing at ${fmt(dist, 2)} ${target.unit || 'mi'} yet`;
    }
    return out;
  }

  // Total distance: cumulative and window-bounded. It only means anything inside the goal's dates,
  // always climbs, and the next goal starts it over.
  const want = Number(target.distance) || 0;
  out.targetLabel = `${fmt(want, 1)} ${target.unit || 'mi'}`;
  const sessions = cardioSessionsInRange(since, goal ? goal.targetDate : null);
  const total = sessions.reduce((s, x) => s + x.distance, 0);
  out.current = total;
  out.currentLabel = `${fmt(total, 1)} ${target.unit || 'mi'}`;
  out.reached = total >= want;
  out.pct = want > 0 ? Math.max(0, Math.min(100, (total / want) * 100)) : 0;
  if (!out.reached) out.gapLabel = `${fmt(want - total, 1)} ${target.unit || 'mi'} to go`;
  out.sessionCount = sessions.length;
  return out;
}

function fmtMinutes(mins) {
  const m = Math.floor(Math.abs(mins));
  const s = Math.round((Math.abs(mins) - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---- Mutations ----
function addExerciseTarget(goalId) {
  if (!Array.isArray(STATE.exTargets)) STATE.exTargets = [];
  STATE.exTargets.push({
    id: uid(), goalId, kind: '1rm',
    liftId: null, weightLb: null, reps: 5,
    distance: null, minutes: null, unit: 'mi',
    createdAt: Date.now(),
  });
  saveState();
  render();
}
function updateExTargetField(id, field, value) {
  const t = (STATE.exTargets || []).find(x => x.id === id);
  if (!t) return;
  if (field === 'kind') { if (EX_TARGET_TYPES.some(x => x.key === value)) t.kind = value; }
  else if (field === 'weight') { const n = Number(value); t.weightLb = n > 0 ? displayToLb(n) : null; }
  else if (field === 'reps') { const n = Math.round(Number(value)); t.reps = n > 0 ? n : 1; }
  else if (field === 'distance') { const n = Number(value); t.distance = n > 0 ? n : null; }
  else if (field === 'minutes') { const n = Number(value); t.minutes = n > 0 ? n : null; }
  else if (field === 'unit') { t.unit = value || 'mi'; }
  saveState();
  render();
}
function deleteExerciseTarget(id) {
  STATE.exTargets = (STATE.exTargets || []).filter(x => x.id !== id);
  saveState();
  render();
}

// ---- Screen ----
function renderExerciseTargets(goal) {
  const targets = exerciseTargets(goal.id);
  return `
    <div class="row" style="margin:22px 0 8px;">
      <div class="subtle-label" style="margin-bottom:0;">TARGETS</div>
      <button class="btn btn-sm" onclick="addExerciseTarget('${goal.id}')">+ ADD TARGET</button>
    </div>
    ${targets.length
      ? `<div class="stack">${targets.map(t => renderExTargetCard(t, goal)).join('')}</div>`
      : emptyState('No targets yet. A training goal’s progress IS its targets — a lift and a number, or a distance and a time.')}`;
}

function renderExTargetCard(t, goal) {
  const p = exTargetProgress(t, goal);
  const type = p.type;
  const lift = liftById(t.liftId);
  const needsLift = type.needs.indexOf('lift') >= 0;
  return `
    <div class="panel ex-target ${p.reached ? 'ex-target-hit' : ''}">
      <div class="ehead">
        <select style="flex:1; font-weight:600;" onchange="updateExTargetField('${t.id}','kind',this.value)">
          ${EX_TARGET_TYPES.map(x => `<option value="${x.key}"${x.key === t.kind ? ' selected' : ''}>${x.label}</option>`).join('')}
        </select>
        <button class="icon-btn" style="color:var(--bad);" onclick="deleteExerciseTarget('${t.id}')">${icon('close')}</button>
      </div>

      ${needsLift ? renderLiftLink(`extarget:${t.id}`, t.liftId) : ''}
      <div class="ex-target-fields">
        ${type.needs.indexOf('weight') >= 0 ? `
          <label class="field"><span class="lbl">Weight (${weightUnitLabel()})</span>
            <input type="number" step="0.5" min="0" inputmode="decimal" value="${t.weightLb != null ? fmt(lbToDisplay(t.weightLb), 1) : ''}"
                   onchange="updateExTargetField('${t.id}','weight',this.value)"></label>` : ''}
        ${type.needs.indexOf('reps') >= 0 ? `
          <label class="field"><span class="lbl">Reps</span>
            <input type="number" step="1" min="1" value="${t.reps || ''}"
                   onchange="updateExTargetField('${t.id}','reps',this.value)"></label>` : ''}
        ${type.needs.indexOf('distance') >= 0 ? `
          <label class="field"><span class="lbl">Distance</span>
            <input type="number" step="0.1" min="0" inputmode="decimal" value="${t.distance ?? ''}"
                   onchange="updateExTargetField('${t.id}','distance',this.value)"></label>` : ''}
        ${type.needs.indexOf('minutes') >= 0 ? `
          <label class="field"><span class="lbl">Minutes</span>
            <input type="number" step="0.1" min="0" inputmode="decimal" value="${t.minutes ?? ''}"
                   onchange="updateExTargetField('${t.id}','minutes',this.value)"></label>` : ''}
      </div>

      ${needsLift && !lift
        ? `<div class="phase-cal-note">Pick a lift and this starts reading your logs for it.</div>`
        : `
        <div class="goal-bar" title="${fmt(p.pct, 0)}%">
          <div class="goal-bar-fill" style="width:${fmt(p.pct, 0)}%; ${p.reached ? 'background:var(--good);' : ''}"></div>
        </div>
        <div class="goal-rows">
          <div class="goal-row">
            <span class="goal-row-k">Target</span>
            <span class="goal-row-v mono">${p.targetLabel}</span>
            <span class="goal-row-x">${type.cumulative ? `since ${fmtGoalDate(goal.startDate)}` : 'best since the goal started'}</span>
          </div>
          <div class="goal-row">
            <span class="goal-row-k">${type.cumulative ? 'So far' : 'Best'}</span>
            <span class="goal-row-v mono ${p.reached ? 'ex-target-hit-text' : ''}">${p.currentLabel}</span>
            <span class="goal-row-x">${p.reached
              ? 'reached'
              : p.gapLabel || (type.cumulative ? '' : 'no qualifying set yet')}</span>
          </div>
          ${p.lifetime ? `
            <div class="goal-row">
              <span class="goal-row-k">Lifetime</span>
              <span class="goal-row-v mono" style="color:var(--text-dim);">${p.lifetime}</span>
              <span class="goal-row-x">before this goal — context, not progress</span>
            </div>` : ''}
        </div>`}
    </div>`;
}

// ---- The PR log ----
//
// The same resolver, asked the other question. Every lift you've ever logged, with its heaviest set
// and its best at a few common rep counts -- which is exactly what a rep-max target reads, so the
// two can never disagree about what your best is.
function renderPrLog() {
  const seen = new Map();
  Object.keys(STATE.logs).forEach(k => {
    const workout = getWorkout(k.slice(k.indexOf('_') + 1));
    if (!workout) return;
    Object.keys(STATE.logs[k].entries || {}).forEach(entryKey => {
      const id = liftIdForLogEntry(workout, entryKey);
      if (id) seen.set(id, true);
    });
  });
  const rows = Array.from(seen.keys())
    .map(id => ({ lift: liftById(id), best: bestForLift(id, null) }))
    .filter(r => r.lift && r.best)
    .sort((a, b) => b.best.lastDate.localeCompare(a.best.lastDate));
  if (!rows.length) {
    return emptyState('No PRs yet. Link your exercises to lifts in Builder → Workouts → Lifts, then log some sets — a PR needs a durable name to hang off.');
  }
  return `
    <div style="font-size:11px; color:var(--text-dim); margin:14px 0; line-height:1.6;">
      Read from the same resolver your targets use, so the two can never disagree about what your best
      is. Deload sets are excluded — reduced work on purpose isn’t a personal best.
    </div>
    <div class="stack">
      ${rows.map(r => {
        const reps = [1, 3, 5, 10].map(n => ({ n, set: r.best.bestAtReps(n) })).filter(x => x.set);
        return `
          <div class="panel">
            <div class="ehead">
              <div style="font-weight:700; font-size:14px;">${escapeHtml(r.lift.name)}</div>
              ${r.lift.muscle ? `<span class="lift-muscle-chip" style="background:${muscleColor(r.lift.muscle) || 'var(--surface2)'};">${r.lift.muscle}</span>` : ''}
            </div>
            <div style="font-size:11px; color:var(--text-faint); margin-bottom:8px;">
              ${r.best.sessions} session${r.best.sessions === 1 ? '' : 's'} · last ${fmtGoalDate(r.best.lastDate)}
            </div>
            <div class="pr-grid">
              ${reps.map(x => `
                <div class="pr-cell">
                  <div class="pr-reps">${x.n} rep${x.n === 1 ? '' : 's'}+</div>
                  <div class="pr-weight mono">${fmt(lbToDisplay(x.set.weightLb), 1)}</div>
                  <div class="pr-date">${fmtGoalDate(x.set.date)}</div>
                </div>`).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

// ---- Setup notes, which belong to the LIFT and therefore outlive everything else ----
//
// A workout log already has a `notes` field, and it is the right field for "how did it feel today".
// It is the wrong field for "bench at 30 degrees, seat position 4" -- a fact about the exercise that
// was true last year and will be true next year, written into one session's log where the next
// phase, cycle or program will never look for it.
//
// So a setup note hangs off the liftId. That is the only identity in this app that survives a phase
// change, a program rewrite, or the same movement appearing as a T3 in one workout and an RP
// exercise in another: link both to Incline Curl and both show the note, because it was never
// attached to either of them.
//
// Stored in its own sparse map rather than on the lift, because LIFT_LIBRARY is a source constant
// -- a shipped lift has nowhere to keep one. Same shape as the lab range overrides for the same
// reason: shipped defaults you can annotate without owning the object.
function liftNotes() {
  if (!STATE.liftNotes || typeof STATE.liftNotes !== 'object') STATE.liftNotes = {};
  return STATE.liftNotes;
}
function liftNote(liftId) { return (liftId && liftNotes()[liftId]) || ''; }
function setLiftNote(liftId, text) {
  if (!liftId) return;
  const t = String(text == null ? '' : text).trim();
  // Cleared means gone, not stored as an empty string: the map is read with `liftNote(id) ?` all
  // over, and a lingering '' would keep an empty note row on screen forever.
  if (t) liftNotes()[liftId] = t;
  else delete liftNotes()[liftId];
  saveState();
}
// Which exercises have their note open right now. A map rather than a single id, because a workout
// is several exercises and opening one has no business closing another -- you might be checking two
// setups against each other.
function liftNoteOpen(liftId) {
  return !!(VIEW.liftNoteOpen && VIEW.liftNoteOpen[liftId]);
}
function toggleLiftNoteEditor(liftId) {
  if (!VIEW.liftNoteOpen) VIEW.liftNoteOpen = {};
  if (VIEW.liftNoteOpen[liftId]) delete VIEW.liftNoteOpen[liftId];
  else VIEW.liftNoteOpen[liftId] = true;
  render();
}
// Saved on blur and the field STAYS OPEN. Collapsing on save would snatch the note away the moment
// you tapped elsewhere to check something -- and blur fires on every tap outside, not just on
// "done", so the close would land at the least useful moment.
function saveLiftNoteFrom(liftId, value) {
  setLiftNote(liftId, value);
  render();
}

// Shown at the top of an exercise while logging it -- before the sets, because it is what you read
// while setting the bench up, not something to review afterwards.
//
// An exercise with no lift linked yet gets nothing at all: there is no identity to hang a note on,
// and inventing one here would create a second, silent way to make a lift. Linking is a deliberate
// act with its own screen (Setup -> Workouts -> Lifts) and its own "did you mean" guard, precisely
// because a wrong link fuses two exercises' histories.
function renderLiftNoteRow(liftId) {
  if (!liftId) return '';
  const note = liftNote(liftId);
  const open = liftNoteOpen(liftId);
  // The header IS the signal. Collapsed and quiet means nothing written here; collapsed and lit
  // means there is something worth opening. That one piece of colour is what lets the field stay
  // shut by default without hiding the fact that it has contents -- it takes its colour from
  // --accent, so every aesthetic gets its own version of "look at me" for free.
  return `
    <div class="lift-note ${note ? 'has-note' : ''} ${open ? 'is-open' : ''}">
      <button class="lift-note-head" onclick="toggleLiftNoteEditor('${liftId}')" aria-expanded="${open}">
        <span class="lift-note-caret">${open ? '&minus;' : '+'}</span>
        <span class="lift-note-label">Notes</span>
      </button>
      ${open ? `
        <div class="lift-note-body">
          <textarea class="lift-note-input" rows="2" placeholder="Bench at 30°, seat 4, EZ bar…"
            onblur="saveLiftNoteFrom('${liftId}', this.value)">${escapeHtml(note)}</textarea>
          <div class="lift-note-hint">Kept with this exercise, not this workout — it follows the lift into any phase.</div>
        </div>` : ''}
    </div>`;
}
