// app-hobbies.js -- the Longevity screen (supplements and the skin-cycling rotation).
//
// Named for what it used to hold: three hardcoded guitar catalogues and their progress timeline,
// which became the first Skill on 2026-09-15 (see src/app-skill-templates.js). Longevity was
// always the odd tenant here and is what's left.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
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
