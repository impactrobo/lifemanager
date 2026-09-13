// app-hobbies.js -- Hobbies (guitar chords/songs/technique and their progress timeline) and the Longevity screen.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ---------------- GUITAR ----------------
function groupByTier(list) {
  const groups = {};
  list.forEach((item, i) => {
    const t = item.tier;
    if (!groups[t]) groups[t] = [];
    groups[t].push(Object.assign({}, item, { idx: i }));
  });
  return groups;
}
function renderLifeGuitar() {
  const g = STATE.life.guitar;
  const chordsLearned = GUITAR_CHORDS.filter((c, i) => g.chordStatus[i] === 2).length;
  const songsLearned = GUITAR_SONGS.filter((s, i) => g.songStatus[i]).length;
  const techLearned = GUITAR_TECHNIQUES.filter((t, i) => g.techStatus[i]).length;
  const summary = `
    <div class="grid3" style="margin-bottom:14px;">
      <div class="panel" style="text-align:center; padding:12px 6px;">
        <div class="mono" style="font-size:20px; font-weight:800;">${chordsLearned}/${GUITAR_CHORDS.length}</div>
        <div style="font-size:10px; color:var(--text-faint);">CHORDS</div>
      </div>
      <div class="panel" style="text-align:center; padding:12px 6px;">
        <div class="mono" style="font-size:20px; font-weight:800;">${songsLearned}/${GUITAR_SONGS.length}</div>
        <div style="font-size:10px; color:var(--text-faint);">SONGS</div>
      </div>
      <div class="panel" style="text-align:center; padding:12px 6px;">
        <div class="mono" style="font-size:20px; font-weight:800;">${techLearned}/${GUITAR_TECHNIQUES.length}</div>
        <div style="font-size:10px; color:var(--text-faint);">TECHNIQUES</div>
      </div>
    </div>`;
  let body = '';
  if (NAV.guitarSubtab === 'chords') body = renderGuitarChords();
  else if (NAV.guitarSubtab === 'songs') body = renderGuitarSongs();
  else if (NAV.guitarSubtab === 'tech') body = renderGuitarTech();
  else if (NAV.guitarSubtab === 'progress') body = renderHobbiesProgress();
  else body = renderGuitarPracticeLog();
  return summary + body;
}
function setGuitarSubtab(t) { NAV.guitarSubtab = t; render(); }
// ---------------- HOBBIES PROGRESS: timeline of learned chords/songs ----------------
function renderHobbiesProgress() {
  const g = STATE.life.guitar;
  const events = [];
  GUITAR_CHORDS.forEach((c, i) => {
    if (g.chordStatus[i] === 2 && g.chordLearnedDate[i]) events.push({ date: g.chordLearnedDate[i], label: c.chord, kind: 'Chord' });
  });
  GUITAR_SONGS.forEach((s, i) => {
    if (g.songStatus[i] && g.songLearnedDate[i]) events.push({ date: g.songLearnedDate[i], label: s.song, kind: 'Song' });
  });
  events.sort((a, b) => b.date.localeCompare(a.date));
  if (events.length === 0) {
    return emptyState('Mark chords as Learned or songs as done to build your timeline here.');
  }
  return `
    <div class="subtle-label" style="margin-bottom:10px;">LEARNING TIMELINE</div>
    <div class="entry-list">
      ${events.map(e => `
        <div class="entry-card">
          <div class="ehead">
            <div class="edate">${e.date}</div>
            <span class="pill" style="background:var(--surface2); color:var(--text-dim);">${e.kind}</span>
          </div>
          <div class="estats"><span><b>${escapeHtml(e.label)}</b></span></div>
        </div>`).join('')}
    </div>`;
}
const CHORD_STATUS_LABELS = ['NOT STARTED', 'LEARNING', 'LEARNED'];
const CHORD_STATUS_COLORS = ['var(--text-faint)', 'var(--warn)', 'var(--good)'];
function renderGuitarChords() {
  const g = STATE.life.guitar;
  const groups = groupByTier(GUITAR_CHORDS);
  return Object.keys(groups).sort().map(tier => `
    <div class="subtle-label" style="margin:14px 0 8px;">TIER ${tier}</div>
    ${groups[tier].map(c => {
      const status = g.chordStatus[c.idx] || 0;
      const color = CHORD_STATUS_COLORS[status];
      return `<div class="panel" style="cursor:pointer;" onclick="cycleChordStatus(${c.idx})">
        <div class="row" style="align-items:flex-start;">
          <div>
            <div style="font-size:14px; font-weight:700;">${escapeHtml(c.chord)}</div>
            <div style="font-size:11px; color:var(--text-dim); margin-top:2px;">${escapeHtml(c.type)}</div>
            <div style="font-size:11px; color:var(--text-faint); margin-top:4px;">${escapeHtml(c.why)}</div>
          </div>
          <span class="pill" style="background:${status===2?'var(--good-soft)':status===1?'rgba(242,201,76,0.15)':'var(--surface2)'}; color:${color}; border:1px solid ${color}; flex-shrink:0;">${CHORD_STATUS_LABELS[status]}</span>
        </div>
      </div>`;
    }).join('')}`).join('');
}
function cycleChordStatus(idx) {
  const g = STATE.life.guitar;
  g.chordStatus[idx] = ((g.chordStatus[idx] || 0) + 1) % 3;
  if (g.chordStatus[idx] === 2) g.chordLearnedDate[idx] = todayStr();
  saveState(); render();
}
function renderGuitarSongs() {
  const g = STATE.life.guitar;
  const groups = groupByTier(GUITAR_SONGS);
  return Object.keys(groups).sort().map(tier => `
    <div class="subtle-label" style="margin:14px 0 8px;">TIER ${tier}</div>
    ${groups[tier].map(s => {
      const done = !!g.songStatus[s.idx];
      return `<div class="panel" style="cursor:pointer;" onclick="toggleSongStatus(${s.idx})">
        <div class="row">
          <div>
            <div style="font-size:14px; font-weight:700;">${escapeHtml(s.song)}</div>
            <div style="font-size:11px; color:var(--text-dim); margin-top:2px;">${escapeHtml(s.artist)} &middot; ${escapeHtml(s.genre)}</div>
          </div>
          <div class="hit-mark ${done?'hit':''}">${done?icon('check'):''}</div>
        </div>
      </div>`;
    }).join('')}`).join('');
}
function toggleSongStatus(idx) {
  const g = STATE.life.guitar;
  g.songStatus[idx] = !g.songStatus[idx];
  if (g.songStatus[idx]) g.songLearnedDate[idx] = todayStr();
  saveState(); render();
}
function renderGuitarTech() {
  const g = STATE.life.guitar;
  return GUITAR_TECHNIQUES.map((t, i) => {
    const done = !!g.techStatus[i];
    return `<div class="panel" style="cursor:pointer;" onclick="toggleTechStatus(${i})">
      <div class="row">
        <div>
          <div style="font-size:14px; font-weight:700;">${escapeHtml(t.name)}</div>
          <div style="font-size:11px; color:var(--text-dim); margin-top:2px;">${escapeHtml(t.what)}</div>
        </div>
        <div class="hit-mark ${done?'hit':''}">${done?icon('check'):''}</div>
      </div>
    </div>`;
  }).join('');
}
function toggleTechStatus(idx) {
  const g = STATE.life.guitar;
  g.techStatus[idx] = !g.techStatus[idx];
  saveState(); render();
}
function renderGuitarPracticeLog() {
  const list = [...STATE.life.guitar.practiceLog].sort((a,b) => b.date.localeCompare(a.date));
  const addForm = UI.guitarLogFormOpen ? renderGuitarLogForm() : `<button class="btn btn-primary btn-block" onclick="toggleGuitarLogForm()">+ ADD PRACTICE SESSION</button>`;
  const cards = list.map(e => `
    <div class="entry-card">
      <div class="ehead">
        <div class="edate">${e.date}</div>
        <button class="icon-btn" onclick="deleteGuitarLog('${e.id}')">${icon('close')}</button>
      </div>
      <div class="estats">
        <span>Minutes <b>${e.minutes}</b></span>
        ${e.notes ? `<span>${escapeHtml(e.notes)}</span>` : ''}
      </div>
    </div>`).join('');
  return `
    <div style="margin-bottom:12px;">${addForm}</div>
    <div class="entry-list">${cards || emptyState('No practice sessions logged yet.')}</div>`;
}
function toggleGuitarLogForm() { UI.guitarLogFormOpen = !UI.guitarLogFormOpen; render(); }
function renderGuitarLogForm() {
  return `
    <div class="panel">
      <div class="field-row">
        <label class="field"><span class="lbl">Date</span><input type="date" id="gDate" value="${todayStr()}"></label>
        <label class="field"><span class="lbl">Minutes</span><input type="number" id="gMinutes"></label>
      </div>
      <label class="field"><span class="lbl">Notes</span><textarea id="gNotes" placeholder="What did you work on?"></textarea></label>
      <button class="btn btn-primary btn-block" onclick="saveGuitarLog()">SAVE ENTRY</button>
      <button class="btn btn-block" style="margin-top:8px;" onclick="toggleGuitarLogForm()">CANCEL ENTRY</button>
    </div>`;
}
function saveGuitarLog() {
  const date = inputVal('gDate') || todayStr();
  const minutes = inputVal('gMinutes');
  const notes = inputVal('gNotes');
  if (!minutes) { showToast('Enter minutes practiced'); return; }
  STATE.life.guitar.practiceLog.push({ id: uid(), date, minutes: Number(minutes), notes });
  UI.guitarLogFormOpen = false;
  saveState();
  showToast('Session logged');
  render();
}
function deleteGuitarLog(id) {
  showConfirm('Delete this practice session?', () => {
    STATE.life.guitar.practiceLog = STATE.life.guitar.practiceLog.filter(e => e.id !== id);
    saveState(); render();
  });
}

// ---------------- LONGEVITY ----------------
function todaySupplementLog() {
  const d = todayStr();
  if (!STATE.life.supplementLog[d]) STATE.life.supplementLog[d] = {};
  return STATE.life.supplementLog[d];
}
function renderLifeLongevity() {
  const suppLog = todaySupplementLog();
  const suppDone = SUPPLEMENTS.filter(s => suppLog[s.name]).length;

  const start = STATE.life.skinCycleStart;
  let skinBlock;
  if (!start) {
    skinBlock = `
      <div class="panel">
        <div class="subtle-label" style="margin-bottom:8px;">SKIN CYCLING</div>
        <div style="font-size:12px; color:var(--text-dim); margin-bottom:10px;">Set the date you started (or want to start) the 4-night rotation (Exfoliate / Retinoid / Recovery / Recovery) to see which night applies today.</div>
        <label class="field"><span class="lbl">Start Date</span><input type="date" id="skinStart" value="${todayStr()}"></label>
        <button class="btn btn-primary btn-block" onclick="setSkinCycleStart()">START ROTATION</button>
      </div>`;
  } else {
    const daysElapsed = Math.max(0, daysSince(start));
    const nightIdx = daysElapsed % 4;
    const night = SKIN_CYCLE_NIGHTS[nightIdx];
    skinBlock = `
      <div class="panel">
        <div class="row" style="margin-bottom:8px;">
          <div class="subtle-label" style="margin-bottom:0;">SKIN CYCLING</div>
          <button class="btn btn-ghost btn-sm" onclick="resetSkinCycle()">RESET</button>
        </div>
        <div style="font-size:13px; font-weight:700; margin-bottom:2px;">Tonight: Night ${nightIdx+1} &mdash; ${night.title}</div>
        <div style="font-size:12px; color:var(--text-dim);">${night.detail}</div>
        <div style="display:flex; gap:6px; margin-top:10px;">
          ${SKIN_CYCLE_NIGHTS.map((n,i) => `<div style="flex:1; text-align:center; padding:6px 2px; border-radius:4px; font-size:10px; font-weight:700; ${i===nightIdx?'background:var(--accent-soft); color:var(--accent); border:1px solid var(--accent-dim);':'background:var(--surface2); color:var(--text-faint); border:1px solid var(--border-soft);'}">N${i+1}</div>`).join('')}
        </div>
      </div>`;
  }

  return `
    <div class="panel">
      <div class="row" style="margin-bottom:8px;">
        <div class="subtle-label" style="margin-bottom:0;">SUPPLEMENTS TODAY</div>
        <span class="mono" style="font-weight:700; font-size:13px;">${suppDone} / ${SUPPLEMENTS.length}</span>
      </div>
      ${SUPPLEMENTS.map((s, i) => {
        const done = !!suppLog[s.name];
        return `<div onclick="toggleSupplement('${s.name.replace(/'/g,"\\'")}')" style="display:flex; gap:10px; align-items:center; padding:8px 0; ${i < SUPPLEMENTS.length-1?'border-bottom:1px solid var(--border-soft);':''} cursor:pointer;">
          <div class="hit-mark ${done?'hit':''}" style="flex-shrink:0;">${done?icon('check'):''}</div>
          <div>
            <div style="font-size:13px; font-weight:600;">${escapeHtml(s.name)}</div>
            <div style="font-size:11px; color:var(--text-faint);">${escapeHtml(s.dose)}</div>
          </div>
        </div>`;
      }).join('')}
      <div style="font-size:10px; color:var(--text-faint); margin-top:8px;">General reference ranges, not personalized medical dosing — confirm with a doctor before starting anything new, especially combining several.</div>
    </div>
    ${skinBlock}
    <div class="subtle-label" style="margin:18px 0 8px;">SLEEP &amp; CIRCADIAN (REFERENCE)</div>
    <div class="panel">
      ${SLEEP_PROTOCOLS.map((p,i) => `<div style="${i < SLEEP_PROTOCOLS.length-1?'margin-bottom:10px;':''}"><div style="font-size:13px; font-weight:600;">${escapeHtml(p.name)}</div><div style="font-size:11px; color:var(--text-dim); margin-top:2px;">${escapeHtml(p.how)}</div></div>`).join('')}
    </div>
  `;
}
function toggleSupplement(name) {
  const log = todaySupplementLog();
  log[name] = !log[name];
  saveState(); render();
}
function setSkinCycleStart() {
  const val = inputVal('skinStart') || todayStr();
  STATE.life.skinCycleStart = val;
  saveState(); render();
}
function resetSkinCycle() {
  showConfirm('Reset the skin cycling rotation? You can set a new start date afterward.', () => {
    STATE.life.skinCycleStart = null;
    saveState(); render();
  });
}
