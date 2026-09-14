// app-skill-targets.js -- named ambitions for a skill: "3 songs at proficient", "20 hours".
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). Classic
// <script>, loaded after app-skill-templates.js.
//
// ---- Mirrors exercise targets, and differs in exactly one way that matters ----
// An exercise target is MONOTONIC: once 225 has been on the bar it has been on the bar, which is
// why .ex-target-hit turns green and stays. A skill target is not. An item's rung is DERIVED from
// its interval, so a bad rating collapses it -- that's what makes the ladder self-correcting, and
// it means "3 songs at proficient" can be true in October and false in December.
//
// So `reached` is STAMPED rather than recomputed. You hit it, and October happened; the tick is
// permanent. But the live count is shown alongside whenever it has since slipped, because hiding a
// real regression to protect a tick would be the app flattering you.
//
// ---- No projection, same as exercise targets ----
// Nothing here extrapolates. Learning moves in steps and stalls exactly as strength does, and a
// straight line through it would be confidently wrong.

// 'new' is deliberately not offered: "3 songs at NEW or better" is every song in the list, so it
// would be a target you clear by typing.
const SKILL_TARGET_RUNGS = ['learning', 'proficient', 'expert', 'mastered'];
const SKILL_TARGET_KINDS = [
  { key: 'items',   label: 'ITEMS AT A RUNG' },
  { key: 'minutes', label: 'PRACTICE TIME' },
];

function allSkillTargets() { return Array.isArray(STATE.skillTargets) ? STATE.skillTargets : []; }
function skillTargetsFor(skillId) { return allSkillTargets().filter(t => t.skillId === skillId); }
function skillTargetById(id) { return allSkillTargets().find(t => t.id === id) || null; }

// "or better", by rank. A mastered item counts toward a proficient target because it has passed
// through proficient -- the ladder is ordered, so the comparison is just an index.
function skillItemsAtRung(skill, listId, rungKey) {
  const min = SKILL_BAND_ORDER.indexOf(rungKey);
  if (min < 0) return 0;
  let n = 0;
  (skill && skill.lists || []).forEach(l => {
    if (listId && l.id !== listId) return;
    (l.items || []).forEach(it => {
      if (SKILL_BAND_ORDER.indexOf(skillItemBand(it).key) >= min) n++;
    });
  });
  return n;
}

// Practice LOGGED in the window, which is what you actually did. Deliberately not the week rollup's
// de-duplicated figure: that one adds scheduled blocks you never logged against, and reproducing it
// here would mean scanning the schedule for every day of the window on every render -- ninety passes
// for a three-month target. The label says "practice logged" so the two numbers can't be confused.
function skillTargetMinutes(skill, target) {
  return (skill && skill.practiceLog || [])
    .filter(e => e.date >= target.createdAt && (!target.byDate || e.date <= target.byDate))
    .reduce((n, e) => n + (Number(e.minutes) || 0), 0);
}

// The read-out, shaped like exTargetProgress(): current, target, gap, reached.
function skillTargetProgress(target) {
  const skill = skillById(target.skillId);
  const want = Math.max(1, Math.round(Number(target.count) || 1));
  const out = { target, skill, want, current: 0, reached: !!target.reachedOn, reachedOn: target.reachedOn || null,
                slipped: false, pct: 0, currentLabel: '—', wantLabel: String(want), targetLabel: '',
                gapLabel: null, overdue: false };
  if (!skill) return out;

  if (target.kind === 'minutes') {
    out.current = skillTargetMinutes(skill, target);
    out.wantLabel = fmtSkillMinutes(want);
    out.targetLabel = out.wantLabel + ' practised';
    // fmtSkillMinutes(0) is an em-dash, which reads as "no data" on the skill list and as a
    // riddle here -- "— of 5h" next to "5h to go". Zero is a real answer on a target.
    out.currentLabel = out.current ? fmtSkillMinutes(out.current) : '0m';
  } else {
    out.current = skillItemsAtRung(skill, target.listId, target.rung);
    const band = SKILL_BANDS.find(b => b.key === target.rung);
    const rungLabel = target.rung === 'mastered' ? 'MASTERED' : (band ? band.label : target.rung.toUpperCase());
    const list = target.listId ? skillListById(skill, target.listId) : null;
    out.targetLabel = `${want} ${list ? escapeHtml(list.name) : 'item' + (want === 1 ? '' : 's')} at ${rungLabel}`;
    out.currentLabel = String(out.current);
  }
  out.pct = Math.max(0, Math.min(100, Math.round((out.current / want) * 100)));
  if (out.current < want) out.gapLabel = target.kind === 'minutes'
    ? `${fmtSkillMinutes(want - out.current)} to go`
    : `${want - out.current} to go`;
  // Minutes only ever accumulate, so a minutes target can't slip. Items can.
  out.slipped = out.reached && target.kind === 'items' && out.current < want;
  out.overdue = !!(target.byDate && !out.reached && target.byDate < todayStr());
  return out;
}

// ---- Stamping ----
//
// Called from the three places a skill's progress can go UP, and that list is exhaustive rather than
// hopeful: an item's rung only rises through applySkillRating() (finishSkillSession) or by claiming
// mastery, and minutes only rise by logging a session either way. Editing a name or a tier can't
// raise a rung; adding an item adds a NEW one, which is rank 0 and can't lift an "at proficient"
// count; deleting only lowers, and lowering never un-stamps.
//
// Doing it here rather than lazily inside skillTargetProgress() keeps the read-out a pure function.
// A renderer that writes to STATE is the kind of thing that works until two of them run in one frame.
function stampReachedSkillTargets(skillId) {
  let changed = false;
  skillTargetsFor(skillId).forEach(t => {
    if (t.reachedOn) return;
    const p = skillTargetProgress(t);
    if (p.current >= p.want) { t.reachedOn = todayStr(); changed = true; }
  });
  return changed;
}

// ---- Mutations ----
function toggleSkillTargetForm() { UI.skillTargetFormOpen = !UI.skillTargetFormOpen; render(); }

function addSkillTarget(skillId) {
  const skill = skillById(skillId);
  if (!skill) return;
  const kind = inputVal('stKind') === 'minutes' ? 'minutes' : 'items';
  const count = Math.round(Number(inputVal('stCount')) || 0);
  if (!count || count <= 0) { showToast(kind === 'minutes' ? 'How many minutes?' : 'How many items?'); return; }
  if (!Array.isArray(STATE.skillTargets)) STATE.skillTargets = [];
  const listId = inputVal('stList') || null;
  STATE.skillTargets.push({
    id: uid(), skillId, kind, count,
    listId: kind === 'items' ? listId : null,
    rung: kind === 'items' ? (inputVal('stRung') || 'proficient') : null,
    byDate: inputVal('stBy') || null,   // optional: a standing ambition is a legitimate target
    createdAt: todayStr(),
    reachedOn: null,
  });
  UI.skillTargetFormOpen = false;
  // A target can be born already met -- "3 songs at proficient" when you have four. Stamping here
  // means it reads as reached straight away rather than waiting for the next session to notice.
  stampReachedSkillTargets(skillId);
  saveState(); render();
}
function deleteSkillTarget(id) {
  const t = skillTargetById(id);
  if (!t) return;
  showConfirm('Delete this target?', () => {
    STATE.skillTargets = allSkillTargets().filter(x => x.id !== id);
    saveState(); render();
  });
}

// ---- Screen ----
function renderSkillTargets(skill) {
  const targets = skillTargetsFor(skill.id);
  const lists = skill.lists || [];
  const form = UI.skillTargetFormOpen ? `
    <div class="panel">
      <label class="field"><span class="lbl">Kind</span>
        <select id="stKind" onchange="render()">
          ${SKILL_TARGET_KINDS.map(k => `<option value="${k.key}">${k.label}</option>`).join('')}
        </select></label>
      <div class="field-row">
        <label class="field"><span class="lbl">How many</span>
          <input type="number" min="1" step="1" id="stCount" placeholder="3"></label>
        <label class="field"><span class="lbl">By (optional)</span>
          <input type="date" id="stBy"></label>
      </div>
      <div class="field-row">
        <label class="field"><span class="lbl">In list</span>
          <select id="stList">
            <option value="">Any list</option>
            ${lists.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}
          </select></label>
        <label class="field"><span class="lbl">At rung</span>
          <select id="stRung">
            ${SKILL_TARGET_RUNGS.map(r => `<option value="${r}" ${r === 'proficient' ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('')}
          </select></label>
      </div>
      <div style="font-size:11px; color:var(--text-faint); margin:-4px 0 10px; line-height:1.5;">
        Minutes count practice you’ve <b>logged</b>, from today onwards. Item targets count anything at
        that rung <i>or better</i>, so a mastered song still counts toward a proficient target.
      </div>
      <button class="btn btn-primary btn-block" onclick="addSkillTarget('${skill.id}')">ADD TARGET</button>
      <button class="btn btn-block" style="margin-top:8px;" onclick="toggleSkillTargetForm()">CANCEL</button>
    </div>` : `<button class="btn btn-primary btn-block" onclick="toggleSkillTargetForm()">+ ADD A TARGET</button>`;

  const cards = targets.map(t => {
    const p = skillTargetProgress(t);
    return `
      <div class="panel skill-target ${p.reached ? 'skill-target-hit' : ''} ${p.overdue ? 'skill-target-late' : ''}">
        <div class="ehead">
          <div class="skill-target-name">${p.targetLabel}</div>
          ${p.reached ? `<span class="skill-band skill-band-expert">&check; REACHED</span>` : ''}
          <button class="icon-btn" style="color:var(--bad);" onclick="deleteSkillTarget('${t.id}')">${icon('close')}</button>
        </div>
        ${p.reached
          ? `<div class="skill-sched"><span class="skill-sched-due">reached ${fmtGoalDate(p.reachedOn)}</span>
               ${p.slipped ? `<span class="skill-sched-bad">${p.currentLabel} of ${p.want} right now</span>` : ''}</div>`
          : `<div class="skill-target-bar"><div class="skill-target-fill" style="width:${p.pct}%;"></div></div>
             <div class="skill-sched">
               <span class="skill-sched-due">${p.currentLabel} of ${p.wantLabel}</span>
               ${p.gapLabel ? `<span>${p.gapLabel}</span>` : ''}
               ${t.byDate ? `<span class="${p.overdue ? 'skill-sched-bad' : ''}">by ${fmtGoalDate(t.byDate)}</span>` : ''}
             </div>`}
      </div>`;
  }).join('');

  return `
    <div style="margin:14px 0 12px;">${form}</div>
    ${targets.length ? `<div class="stack">${cards}</div>`
      : emptyState('No targets yet. “Three songs at proficient by December”, or “twenty hours of practice”.')}
    <div style="font-size:10px; color:var(--text-faint); margin-top:14px; line-height:1.5;">
      Nothing here projects a finish date. Learning moves in steps and stalls, and a straight line
      through it would be confidently wrong — the same reason exercise targets don’t either.
    </div>`;
}
