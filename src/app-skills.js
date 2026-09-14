// app-skills.js -- Skills: a name, some lists of things to learn, and a practice log.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). Classic
// <script>, loaded after app-hobbies.js; see app-goals.js's header for what load order does and
// doesn't constrain.
//
// ---- Why this exists ----
// Hobbies was guitar, and only guitar: three hardcoded catalogues (GUITAR_CHORDS / GUITAR_SONGS /
// GUITAR_TECHNIQUES) plus a practice log, all bolted to STATE.life.guitar. Strip the naming and
// those three are the same object wearing different field names -- a tiered list of named things
// with a blurb, tracked by status, feeding a timeline. So they generalise into ONE shape, and
// guitar becomes the first skill rather than the only one.
//
// ---- Identity, and the bug this replaces ----
// The old catalogues tracked progress by ARRAY INDEX into a shipped constant: g.chordStatus[3]
// meant "whatever sits 4th in GUITAR_CHORDS today". Insert or reorder one chord and every saved
// status from there on silently shifts onto the wrong item. Nothing guarded it. Here an item is a
// record with its own id and its own progress ON the record, so there is no parallel structure to
// keep aligned and the failure can't recur. Same reasoning as the lift library.
//
// ---- Where the scheduling lives ----
// This file owns the SHAPE -- an item's reps/ease/interval/dueIn and the rung derived from them.
// What moves those numbers (block building, the time-then-frequency taper, AGAIN/HARD/GOOD/EASY,
// the WIP limit) is src/app-skill-session.js, which loads next.

// Percent-free, deliberately: an item's rung is DERIVED from its interval rather than stored, so
// it can't drift out of step with the ratings that produced it, and it self-corrects -- a bad
// rating collapses the interval and the rung follows it back down with no bookkeeping.
//
// `mastered` is the one stored rung, because it's a claim you make ("I will always have this")
// rather than something the app can observe.
const SKILL_BANDS = [
  { max: 0,        key: 'new',        label: 'NEW' },
  { max: 2,        key: 'learning',   label: 'LEARNING' },
  { max: 4,        key: 'proficient', label: 'PROFICIENT' },
  { max: Infinity, key: 'expert',     label: 'EXPERT' },
];
// Crossing this earns a READY TO MASTER badge -- an offer, never an automatic promotion.
const SKILL_MASTER_AT = 20;

function skillItemBand(item) {
  if (item && item.mastered) return { key: 'mastered', label: 'MASTERED' };
  const iv = Math.max(0, Number(item && item.interval) || 0);
  const band = SKILL_BANDS.find(b => iv <= b.max) || SKILL_BANDS[SKILL_BANDS.length - 1];
  return { key: band.key, label: band.label, readyToMaster: iv >= SKILL_MASTER_AT };
}

function defaultSkillItem(name, detail, detail2, tier) {
  return {
    id: uid(), name: (name || '').trim(), detail: detail || '', detail2: detail2 || '', tier: tier || 1,
    // Scheduling state. Untouched until the session engine lands -- see the file header.
    reps: 0, ease: SKILL_EASE_DEFAULT, interval: 0, dueIn: 0, lastPractised: null,
    mastered: false, deferrals: 0,
  };
}
function defaultSkillList(name, tiered) {
  return { id: uid(), name: (name || 'Items').trim(), tiered: tiered !== false, items: [] };
}
function defaultSkill(name) {
  return {
    id: uid(), name: (name || 'New skill').trim(), color: null,
    archived: false, createdAt: Date.now(),
    lists: [], practiceLog: [],
  };
}

function allSkills() { return Array.isArray(STATE.skills) ? STATE.skills : []; }
function activeSkills() { return allSkills().filter(s => !s.archived); }
function skillById(id) { return allSkills().find(s => s.id === id) || null; }
function skillListById(skill, listId) { return ((skill && skill.lists) || []).find(l => l.id === listId) || null; }
function skillItemById(skill, itemId) {
  for (const l of (skill && skill.lists) || []) {
    const it = (l.items || []).find(x => x.id === itemId);
    if (it) return { list: l, item: it };
  }
  return null;
}
function skillItemCount(skill) {
  return ((skill && skill.lists) || []).reduce((n, l) => n + ((l.items || []).length), 0);
}
// Minutes practised since a date (inclusive). Feeds the skill list's "this week" read-out, and
// later the time rollup -- one definition so the two can't disagree.
function skillMinutesSince(skill, sinceDate) {
  return ((skill && skill.practiceLog) || [])
    .filter(e => !sinceDate || e.date >= sinceDate)
    .reduce((n, e) => n + (Number(e.minutes) || 0), 0);
}
function fmtSkillMinutes(mins) {
  if (!mins) return '—';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m`;
}

// ---- Mutations ----
function createSkill() {
  const name = (inputVal('newSkillName') || '').trim();
  if (!name) { showToast('Give the skill a name'); return; }
  if (!Array.isArray(STATE.skills)) STATE.skills = [];
  const skill = defaultSkill(name);
  // A skill with no lists can't hold anything, and "add a list" as a required first step reads as
  // busywork. One list named after the skill is a sane floor you can rename or add beside.
  skill.lists.push(defaultSkillList('Items', true));
  STATE.skills.push(skill);
  UI.skillFormOpen = false;
  saveState();
  openSkill(skill.id);
}
function renameSkill(id, value) {
  const s = skillById(id);
  const t = (value || '').trim();
  if (!s || !t) return;
  s.name = t;
  saveState(); render();
}
function deleteSkill(id) {
  const s = skillById(id);
  if (!s) return;
  showConfirm(`Delete “${s.name}”? Its lists and practice history go with it.`, () => {
    STATE.skills = allSkills().filter(x => x.id !== id);
    if (NAV.skillId === id) NAV.skillId = null;
    // The session goes with the skill. loadState() drops an orphan on the next boot anyway, but
    // leaving one live until then means the runner is on screen with nothing behind it.
    if (STATE.skillSession && STATE.skillSession.skillId === id) STATE.skillSession = null;
    saveState(); render();
  });
}
function toggleSkillForm() { UI.skillFormOpen = !UI.skillFormOpen; render(); }

function addSkillList(skillId) {
  const s = skillById(skillId);
  if (!s) return;
  s.lists.push(defaultSkillList('New list', true));
  NAV.skillSubtab = s.lists[s.lists.length - 1].id;
  saveState(); render();
}
function renameSkillList(skillId, listId, value) {
  const l = skillListById(skillById(skillId), listId);
  const t = (value || '').trim();
  if (!l || !t) return;
  l.name = t;
  saveState(); render();
}
function toggleSkillListTiered(skillId, listId) {
  const l = skillListById(skillById(skillId), listId);
  if (!l) return;
  l.tiered = !l.tiered;
  saveState(); render();
}
function deleteSkillList(skillId, listId) {
  const s = skillById(skillId);
  const l = skillListById(s, listId);
  if (!s || !l) return;
  showConfirm(`Delete the “${l.name}” list and its ${(l.items || []).length} items?`, () => {
    const ids = (l.items || []).map(x => x.id);
    s.lists = s.lists.filter(x => x.id !== listId);
    if (NAV.skillSubtab === listId) NAV.skillSubtab = 'log';
    const dropped = dropFromSkillSession(s, ids);
    if (dropped) showToast(`${dropped} item${dropped === 1 ? '' : 's'} removed from the block in progress`);
    saveState(); render();
  });
}

function addSkillItem(skillId, listId) {
  const l = skillListById(skillById(skillId), listId);
  if (!l) return;
  const name = (inputVal('newItem_' + listId) || '').trim();
  if (!name) { showToast('Name the item first'); return; }
  const tier = Math.max(1, Math.round(Number(inputVal('newItemTier_' + listId)) || 1));
  l.items.push(defaultSkillItem(name, '', '', l.tiered ? tier : 1));
  saveState(); render();
}
function updateSkillItem(skillId, itemId, field, value) {
  const found = skillItemById(skillById(skillId), itemId);
  if (!found) return;
  const it = found.item;
  if (field === 'name') { const t = (value || '').trim(); if (t) it.name = t; }
  else if (field === 'detail') it.detail = value || '';
  else if (field === 'detail2') it.detail2 = value || '';
  else if (field === 'tier') { const n = Math.round(Number(value)); if (n >= 1) it.tier = n; }
  saveState(); render();
}
function deleteSkillItem(skillId, itemId) {
  const s = skillById(skillId);
  const found = skillItemById(s, itemId);
  if (!found) return;
  found.list.items = found.list.items.filter(x => x.id !== itemId);
  if (dropFromSkillSession(s, [itemId])) showToast('Removed from the block in progress too');
  saveState(); render();
}
// The one rung you claim rather than earn. Reversible, for the day you find out you were wrong.
function toggleSkillItemMastered(skillId, itemId) {
  const found = skillItemById(skillById(skillId), itemId);
  if (!found) return;
  found.item.mastered = !found.item.mastered;
  saveState();
  showToast(found.item.mastered ? 'Mastered — retired from practice' : 'Back in rotation');
  render();
}

function toggleSkillLogForm() { UI.skillLogFormOpen = !UI.skillLogFormOpen; render(); }
function saveSkillPractice(skillId) {
  const s = skillById(skillId);
  if (!s) return;
  const minutes = Number(inputVal('skillLogMinutes'));
  if (!minutes || minutes <= 0) { showToast('Enter minutes practised'); return; }
  s.practiceLog.push({
    id: uid(), date: inputVal('skillLogDate') || todayStr(),
    minutes: Math.round(minutes), notes: inputVal('skillLogNotes') || '',
    // What the session did to each item. A hand-logged entry moved nothing, so it stays empty --
    // the field exists on every entry so the two kinds read the same way.
    moves: [],
  });
  UI.skillLogFormOpen = false;
  saveState();
  showToast('Session logged');
  render();
}
function deleteSkillPractice(skillId, entryId) {
  const s = skillById(skillId);
  if (!s) return;
  showConfirm('Delete this practice session?', () => {
    s.practiceLog = s.practiceLog.filter(e => e.id !== entryId);
    saveState(); render();
  });
}

// ---- Navigation ----
//
// NAV.skillId carries three states rather than needing a second flag beside it:
//   null                -> the skill list
//   LEGACY_GUITAR_ID    -> the old hardcoded guitar screens, until the migration step
//   anything else       -> that skill
// A separate "is legacy guitar open" boolean would be a second source of truth for one question,
// and the two would eventually disagree.
const LEGACY_GUITAR_ID = '__legacy_guitar__';
function openSkill(id) { NAV.skillId = id; NAV.skillSubtab = 'log'; render(); }
function openLegacyGuitar() { NAV.skillId = LEGACY_GUITAR_ID; setGuitarSubtab('chords'); }
function closeSkill() { NAV.skillId = null; render(); }
function setSkillSubtab(t) { NAV.skillSubtab = t; render(); }

// ---- Screens ----
//
// Two levels: a list of skills, and one skill. Home keeps a single HOBBIES tile and skills
// multiply behind it rather than in the tile grid, so adding a tenth skill never touches Home.
//
// The per-skill lists live in the in-screen `.subnav`, NOT the bottom tabbar. That's deliberate: a
// skill can have any number of lists, so that strip has to survive arbitrary width, and `.subnav`
// already has the scroll-chevron affordance system while `.tabbar` is the one with a logged
// overflow bug at seven buttons. Variable-width content goes in the strip built to handle it.
function renderSkillsTab() {
  return NAV.skillId && skillById(NAV.skillId) ? renderOneSkill(skillById(NAV.skillId)) : renderSkillList();
}

function renderSkillList() {
  const weekAgo = shiftDate(todayStr(), -6);
  const list = activeSkills();
  const rows = list.map(s => {
    const mins = skillMinutesSince(s, weekAgo);
    const n = skillItemCount(s);
    return `
      <button class="skill-row" onclick="openSkill('${s.id}')">
        <div class="skill-row-main">
          <div class="skill-row-name">${escapeHtml(s.name)}</div>
          <div class="skill-row-sub">${n} item${n === 1 ? '' : 's'} · ${s.lists.length} list${s.lists.length === 1 ? '' : 's'}</div>
        </div>
        <div class="skill-row-time">
          <div class="mono">${fmtSkillMinutes(mins)}</div>
          <div class="skill-row-when">this week</div>
        </div>
        <span class="skill-row-chev">${icon('chevronRight')}</span>
      </button>`;
  }).join('');

  return `
    <div class="row" style="margin:18px 0 10px; align-items:flex-start;">
      <div class="subtle-label" style="margin-bottom:0; padding-top:8px;">SKILLS</div>
      <button class="btn btn-sm btn-primary" onclick="toggleSkillForm()">${UI.skillFormOpen ? 'CANCEL' : '+ ADD SKILL'}</button>
    </div>
    ${UI.skillFormOpen ? `
      <div class="panel">
        <label class="field"><span class="lbl">What are you learning?</span>
          <input type="text" id="newSkillName" placeholder="e.g. Spanish, Cooking, Drawing"></label>
        <div style="font-size:11px; color:var(--text-faint); margin:-4px 0 10px; line-height:1.5;">
          Starts with one list you can rename, and as many more as you want beside it — a language
          might want Vocabulary and Grammar; a kitchen might want Recipes and Knife skills.
        </div>
        <button class="btn btn-primary btn-block" onclick="createSkill()">CREATE</button>
      </div>` : ''}
    ${rows ? `<div class="skill-list">${rows}</div>`
           : emptyState('No skills yet. Add one for anything you’re building — an instrument, a language, a craft.')}
    ${renderLegacyGuitarRow()}`;
}

// Guitar still lives in its own hardcoded screens until the migration step. Rather than hide it
// behind a half-built feature, it gets a row here that opens the existing views unchanged -- so
// nothing regresses while the new shape is proven beside it.
function renderLegacyGuitarRow() {
  const g = STATE.life && STATE.life.guitar;
  if (!g) return '';
  const logged = (g.practiceLog || []).length;
  return `
    <div class="subtle-label" style="margin:22px 0 8px;">NOT YET MIGRATED</div>
    <button class="skill-row skill-row-legacy" onclick="openLegacyGuitar()">
      <div class="skill-row-main">
        <div class="skill-row-name">Guitar</div>
        <div class="skill-row-sub">${GUITAR_CHORDS.length + GUITAR_SONGS.length + GUITAR_TECHNIQUES.length} items · ${logged} session${logged === 1 ? '' : 's'}</div>
      </div>
      <span class="pill" style="background:var(--surface2); color:var(--text-dim);">LEGACY</span>
      <span class="skill-row-chev">${icon('chevronRight')}</span>
    </button>
    <div style="font-size:11px; color:var(--text-faint); margin-top:6px; line-height:1.5;">
      Still on its original screens. It becomes a real skill — with its progress carried across — in
      the next step.
    </div>`;
}

function renderOneSkill(skill) {
  const tab = (key, label) =>
    `<button class="${NAV.skillSubtab === key ? 'active' : ''}" onclick="setSkillSubtab('${key}')">${escapeHtml(label)}</button>`;
  const subnav = subNav(
    tab('log', 'LOG') + skill.lists.map(l => tab(l.id, l.name)).join('') + tab('progress', 'PROGRESS'),
    { marginTop: false });

  let body;
  if (NAV.skillSubtab === 'log') body = renderSkillPracticeLog(skill);
  else if (NAV.skillSubtab === 'progress') body = renderSkillTimeline(skill);
  else {
    const l = skillListById(skill, NAV.skillSubtab);
    body = l ? renderSkillItemList(skill, l) : renderSkillPracticeLog(skill);
  }

  return `
    <div class="row" style="margin-bottom:6px;">
      <button class="btn btn-ghost btn-sm" onclick="closeSkill()">&#8249; SKILLS</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--bad);" onclick="deleteSkill('${skill.id}')">DELETE</button>
    </div>
    <input type="text" class="skill-title" value="${escapeHtml(skill.name)}"
           onchange="renameSkill('${skill.id}', this.value)">
    ${subnav}
    ${body}`;
}

function renderSkillItemList(skill, list) {
  const items = list.items || [];
  const card = (it) => {
    const band = skillItemBand(it);
    return `
      <div class="panel skill-item skill-item-${band.key}">
        <div class="ehead">
          <input type="text" class="skill-item-name" value="${escapeHtml(it.name)}"
                 onchange="updateSkillItem('${skill.id}','${it.id}','name',this.value)">
          ${skillItemIsStuck(it) ? `<span class="skill-band skill-band-stuck">STUCK</span>` : ''}
          <span class="skill-band skill-band-${band.key}">${band.label}</span>
          <button class="icon-btn" style="color:var(--bad);" onclick="deleteSkillItem('${skill.id}','${it.id}')">${icon('close')}</button>
        </div>
        <input type="text" class="skill-item-detail" placeholder="A note about it — what it is, why it matters"
               value="${escapeHtml(it.detail)}" onchange="updateSkillItem('${skill.id}','${it.id}','detail',this.value)">
        ${renderSkillSchedule(it)}
        ${band.readyToMaster && !it.mastered
          ? `<button class="btn btn-sm btn-good btn-block" style="margin-top:8px;" onclick="toggleSkillItemMastered('${skill.id}','${it.id}')">READY TO MASTER &mdash; RETIRE IT</button>`
          : it.mastered
            ? `<button class="btn btn-sm btn-block" style="margin-top:8px;" onclick="toggleSkillItemMastered('${skill.id}','${it.id}')">BRING BACK INTO ROTATION</button>`
            : ''}
      </div>`;
  };

  // Tiered lists group under TIER headings; flat ones are one run. groupByTier() already existed
  // for guitar and needs nothing added -- it was generic the whole time.
  let body;
  if (!items.length) {
    body = emptyState('Nothing in this list yet.');
  } else if (list.tiered) {
    const groups = {};
    items.forEach(it => { (groups[it.tier] = groups[it.tier] || []).push(it); });
    body = Object.keys(groups).sort((a, b) => Number(a) - Number(b)).map(t => `
      <div class="subtle-label" style="margin:14px 0 8px;">TIER ${t}</div>
      <div class="stack">${groups[t].map(card).join('')}</div>`).join('');
  } else {
    body = `<div class="stack">${items.map(card).join('')}</div>`;
  }

  return `
    <div class="row" style="margin:14px 0 10px;">
      <input type="text" class="skill-list-name" value="${escapeHtml(list.name)}"
             onchange="renameSkillList('${skill.id}','${list.id}',this.value)">
      <div style="display:flex; gap:6px; flex:none;">
        <button class="btn btn-sm" onclick="toggleSkillListTiered('${skill.id}','${list.id}')">${list.tiered ? 'TIERED' : 'FLAT'}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteSkillList('${skill.id}','${list.id}')">${icon('close')}</button>
      </div>
    </div>
    <div class="panel skill-add-row">
      <input type="text" id="newItem_${list.id}" placeholder="Add an item…">
      ${list.tiered ? `<input type="number" min="1" step="1" value="1" id="newItemTier_${list.id}" title="Tier" style="flex:0 0 62px;">` : ''}
      <button class="btn btn-sm btn-primary" onclick="addSkillItem('${skill.id}','${list.id}')">ADD</button>
    </div>
    ${body}
    <button class="btn btn-sm btn-block" style="margin-top:16px;" onclick="addSkillList('${skill.id}')">+ ANOTHER LIST</button>`;
}

function renderSkillPracticeLog(skill) {
  // A block in progress takes the whole subtab. A second place to find it would only be a second
  // place to lose it, and there is nothing else you want on screen while you're practising.
  const session = activeSkillSession();
  if (session && session.skillId === skill.id) return renderSkillSession(skill, session);
  const list = [...(skill.practiceLog || [])].sort((a, b) => b.date.localeCompare(a.date));
  const week = skillMinutesSince(skill, shiftDate(todayStr(), -6));
  const all = skillMinutesSince(skill, null);
  const form = UI.skillLogFormOpen ? `
    <div class="panel">
      <div class="field-row">
        <label class="field"><span class="lbl">Date</span><input type="date" id="skillLogDate" value="${todayStr()}"></label>
        <label class="field"><span class="lbl">Minutes</span><input type="number" min="1" step="1" id="skillLogMinutes"></label>
      </div>
      <label class="field"><span class="lbl">Notes</span><textarea id="skillLogNotes" placeholder="What did you work on?"></textarea></label>
      <button class="btn btn-primary btn-block" onclick="saveSkillPractice('${skill.id}')">SAVE SESSION</button>
      <button class="btn btn-block" style="margin-top:8px;" onclick="toggleSkillLogForm()">CANCEL</button>
    </div>`
    // Deliberately NOT a primary button: running a block is the main path now, and two primaries
    // stacked would make you choose between them before you knew the difference. This one is for
    // practice that happened away from the app.
    : `<button class="btn btn-sm btn-block" onclick="toggleSkillLogForm()">+ LOG TIME BY HAND</button>`;

  return `
    <div class="grid2" style="margin:14px 0;">
      <div class="panel" style="text-align:center; padding:12px 6px;">
        <div class="mono" style="font-size:20px; font-weight:800;">${fmtSkillMinutes(week)}</div>
        <div style="font-size:10px; color:var(--text-faint);">THIS WEEK</div>
      </div>
      <div class="panel" style="text-align:center; padding:12px 6px;">
        <div class="mono" style="font-size:20px; font-weight:800;">${fmtSkillMinutes(all)}</div>
        <div style="font-size:10px; color:var(--text-faint);">ALL TIME</div>
      </div>
    </div>
    ${renderSkillSessionStarter(skill)}
    <div style="margin-bottom:12px;">${form}</div>
    <div class="entry-list">${list.map(e => `
      <div class="entry-card">
        <div class="ehead">
          <div class="edate">${e.date}</div>
          <button class="icon-btn" onclick="deleteSkillPractice('${skill.id}','${e.id}')">${icon('close')}</button>
        </div>
        <div class="estats">
          <span>Minutes <b>${e.minutes}</b></span>
          ${e.notes ? `<span>${escapeHtml(e.notes)}</span>` : ''}
        </div>
      </div>`).join('') || emptyState('No sessions logged yet.')}</div>`;
}

// The stuck list, which is the whole "filter, not a model" argument made visible. An item you rate
// AGAIN every session sits pinned at the ease floor and quietly eats your practice time, and finding
// it is a one-line predicate over data the engine already keeps. It lives on PROGRESS rather than
// beside the practice starter because it's a diagnosis, not a thing to act on mid-session -- and
// because stuck items can be spread across several lists, so a per-list filter would hide half of
// them. Nothing here is a prompt: it names them and stops, the same posture as READY TO MASTER.
function renderStuckSkillItems(skill) {
  const stuck = stuckSkillItems(skill);
  if (!stuck.length) return '';
  return `
    <div class="subtle-label" style="margin:22px 0 8px;">FIGHTING YOU</div>
    <div class="panel skill-stuck">
      <div class="skill-start-note" style="margin-bottom:9px;">
        ${stuck.length === 1 ? 'This one is' : `These ${stuck.length} are`} at the difficulty floor —
        rated hard or lost often enough that ${stuck.length === 1 ? 'it keeps' : 'they keep'}
        resurfacing. Worth breaking down differently rather than repeating.
      </div>
      <div class="stack">${stuck.map(({ list, item }) => `
        <div class="skill-stuck-row">
          <span class="skill-stuck-name">${escapeHtml(item.name)}</span>
          <span class="skill-stuck-list">${escapeHtml(list.name)}</span>
          <span class="skill-band skill-band-stuck">${skillClampEase(item.ease).toFixed(2)}</span>
        </div>`).join('')}</div>
    </div>`;
}

// The timeline reads the ladder rather than a separate "learned date" map -- which is also what
// finally fixes guitar's Techniques list never appearing on its own timeline, since that list
// simply never stamped a date. Every item is on the same footing here by construction.
function renderSkillTimeline(skill) {
  const counts = { new: 0, learning: 0, proficient: 0, expert: 0, mastered: 0 };
  const dated = [];
  (skill.lists || []).forEach(l => (l.items || []).forEach(it => {
    const band = skillItemBand(it);
    counts[band.key] = (counts[band.key] || 0) + 1;
    if (it.lastPractised) dated.push({ date: it.lastPractised, name: it.name, list: l.name, band });
  }));
  dated.sort((a, b) => b.date.localeCompare(a.date));

  const total = skillItemCount(skill);
  const bar = total ? ['new', 'learning', 'proficient', 'expert', 'mastered']
    .filter(k => counts[k])
    .map(k => `<div class="skill-bar-seg skill-bar-${k}" style="width:${(counts[k] / total) * 100}%;" title="${k}: ${counts[k]}"></div>`)
    .join('') : '';

  return `
    ${total ? `
      <div class="skill-bar" style="margin:16px 0 8px;">${bar}</div>
      <div class="skill-legend">
        ${['new', 'learning', 'proficient', 'expert', 'mastered'].map(k =>
          `<span class="skill-legend-item"><i class="skill-bar-${k}"></i>${k} ${counts[k] || 0}</span>`).join('')}
      </div>` : ''}
    ${renderStuckSkillItems(skill)}
    <div class="subtle-label" style="margin:22px 0 8px;">RECENTLY PRACTISED</div>
    <div class="entry-list">${dated.slice(0, 30).map(e => `
      <div class="entry-card">
        <div class="ehead">
          <div class="edate">${e.date}</div>
          <span class="skill-band skill-band-${e.band.key}">${e.band.label}</span>
        </div>
        <div class="estats"><span><b>${escapeHtml(e.name)}</b></span><span>${escapeHtml(e.list)}</span></div>
      </div>`).join('') || emptyState('Nothing practised yet — the timeline fills in as you log sessions.')}</div>`;
}
