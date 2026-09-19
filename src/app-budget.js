// app-budget.js -- Budget: savings goals, recurring income and charges, incidentals, the budget bar and its screens.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ================= BUDGET =================
// Month state is shared across all three Budget subtabs (Home/Income/Recurring) so paging
// to a different month in one carries over to the others, same spirit as NAV.calMonth.
function ensureBudgetMonth() {
  if (!NAV.budgetMonth) { const d = nowDate(); NAV.budgetMonth = { year: d.getFullYear(), month: d.getMonth() }; }
}
function budgetMonthKey() {
  ensureBudgetMonth();
  return `${NAV.budgetMonth.year}-${String(NAV.budgetMonth.month + 1).padStart(2, '0')}`;
}
function budgetGoToMonth(delta) {
  ensureBudgetMonth();
  let m = NAV.budgetMonth.month + delta, y = NAV.budgetMonth.year;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  NAV.budgetMonth = { year: y, month: m };
  render();
}
function setBudgetSubtab(t) { NAV.budgetSubtab = t; render(); }

function budgetIncomeEntriesForMonth(key) { return STATE.budget.incomeLog[key] || []; }
function budgetIncidentalsForMonth(key) { return STATE.budget.incidentals[key] || []; }
function budgetAdditionalIncomeTotal(key) {
  return budgetIncomeEntriesForMonth(key).reduce((s, e) => s + (Number(e.amount) || 0), 0);
}
function budgetIncidentalsTotal(key) {
  return budgetIncidentalsForMonth(key).reduce((s, e) => s + (Number(e.amount) || 0), 0);
}
function budgetRecurringTotal() {
  return STATE.budget.recurring.filter(r => r.active).reduce((s, r) => s + (Number(r.amount) || 0), 0);
}
// Recurring charges flagged isSavings are still a reserved outflow (money leaving each month,
// same as rent or a subscription) but it's going toward the person's own savings/investments
// rather than spent — split out so the budget bar and legend can show that slice separately.
function budgetRecurringExpenseTotal() {
  return STATE.budget.recurring.filter(r => r.active && !r.isSavings).reduce((s, r) => s + (Number(r.amount) || 0), 0);
}
function budgetRecurringSavingsTotal() {
  return STATE.budget.recurring.filter(r => r.active && r.isSavings).reduce((s, r) => s + (Number(r.amount) || 0), 0);
}
// A savings-flagged recurring charge reserves its slice every month automatically, but it isn't
// necessarily actually *done* yet — savingsCompletions tracks, per month, which of those charges
// the user has confirmed contributing, so the budget bar can show a lighter "planned" outline
// that fills solid as each one gets checked off, rather than treating the whole slice as complete
// the instant a charge is flagged isSavings.
function budgetSavingsCompletionIds(key) {
  return STATE.budget.savingsCompletions[key] || [];
}
function isSavingsCompletedForMonth(key, id) {
  return budgetSavingsCompletionIds(key).includes(id);
}
function budgetRecurringSavingsCompletedTotal(key) {
  const doneIds = budgetSavingsCompletionIds(key);
  return STATE.budget.recurring
    .filter(r => r.active && r.isSavings && doneIds.includes(r.id))
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
}
function toggleSavingsCompletion(key, id, checked) {
  if (!STATE.budget.savingsCompletions[key]) STATE.budget.savingsCompletions[key] = [];
  const arr = STATE.budget.savingsCompletions[key];
  const idx = arr.indexOf(id);
  if (checked && idx === -1) arr.push(id);
  else if (!checked && idx !== -1) arr.splice(idx, 1);
  syncGoalContributionForRecurringCharge(key, id, checked);
  saveState();
  render();
}
// A recurring isSavings charge linked to a goal (goal.recurringChargeId) auto-adds/removes a
// contribution to that goal every time this exact checkbox is toggled, so the goal's running
// balance stays in sync with the existing monthly-completion mechanic instead of needing the
// same $ logged twice in two places. The entry's id is deterministic (month + charge), so
// unchecking finds and removes exactly the one entry it added — never a manual entry that just
// happens to share an amount.
function syncGoalContributionForRecurringCharge(monthKey, chargeId, checked) {
  const goal = STATE.budget.goals.find(g => g.recurringChargeId === chargeId);
  if (!goal) return;
  const autoId = 'auto_' + monthKey + '_' + chargeId;
  if (checked) {
    if (goal.contributions.some(c => c.id === autoId)) return; // already synced
    const charge = STATE.budget.recurring.find(r => r.id === chargeId);
    const amount = charge ? Number(charge.amount) || 0 : 0;
    if (amount <= 0) return;
    // Dated to the last day of the month the checkbox is actually for, not "today" — the two
    // can differ (e.g. catching up on last month's box after the month has turned over).
    const [y, m] = monthKey.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const date = dateKey(y, m - 1, lastDay); // m is 1-indexed out of the monthKey; dateKey wants 0-indexed
    // A recurring-charge-linked contribution is always effectively counted against the budget —
    // it's the reserved slice itself, not a separate Incidental — so this is unconditionally true
    // here, unlike the opt-in checkbox on a manual contribution below.
    goal.contributions.push({ id: autoId, date, amount, note: charge ? charge.name : '', source: 'recurring', countedAgainstBudget: true });
  } else {
    goal.contributions = goal.contributions.filter(c => c.id !== autoId);
  }
}

// ---- Savings Goals: named targets with a running balance, distinct from the monthly savings
// slice above — see the comment above defaultBudgetState()'s `goals` field for the full picture. ----
function goalContributionsInScope(goal) {
  if (!goal.resetsAnnually) return goal.contributions;
  const year = String(nowDate().getFullYear());
  return goal.contributions.filter(c => c.date.slice(0, 4) === year);
}
function goalProgress(goal) {
  return goalContributionsInScope(goal).reduce((s, c) => s + (Number(c.amount) || 0), 0);
}
function goalPct(goal) {
  if (!goal.targetAmount) return 0;
  return Math.max(0, Math.min(100, goalProgress(goal) / goal.targetAmount * 100));
}
function goalIsComplete(goal) {
  return goal.targetAmount > 0 && goalProgress(goal) >= goal.targetAmount;
}
// Returns whether it saved, so saveSavingsGoal() knows whether to close the form. Does not render:
// its caller does that once, after deciding.
function addSavingsGoal() {
  const nameEl = document.getElementById('goalName');
  const name = nameEl ? nameEl.value.trim() : '';
  const amountEl = document.getElementById('goalTarget');
  const amount = Number(amountEl && amountEl.value);
  if (!name) { showToast('Give it a name'); return false; }
  if (!amount || amount <= 0) { showToast('Enter a target amount'); return false; }
  const resetsAnnually = inputChecked('goalResetsAnnually');
  STATE.budget.goals.push({ id: uid(), name, targetAmount: amount, resetsAnnually, recurringChargeId: null, contributions: [], archived: false, createdAt: Date.now() });
  saveState();
  showToast('Goal added');
  return true;
}
function updateGoalField(id, field, value) {
  const g = STATE.budget.goals.find(x => x.id === id);
  if (!g) return;
  if (field === 'targetAmount') g.targetAmount = Number(value) || 0;
  else if (field === 'name') { const trimmed = value.trim(); if (trimmed) g.name = trimmed; }
  else if (field === 'resetsAnnually') g.resetsAnnually = value;
  else if (field === 'recurringChargeId') g.recurringChargeId = value || null;
  saveState(); render();
}
function deleteSavingsGoal(id) {
  showConfirm('Delete this goal? Its contribution history goes with it.', () => {
    STATE.budget.goals = STATE.budget.goals.filter(g => g.id !== id);
    saveState(); render();
  });
}
// countAgainstBudget is opt-in per contribution (not automatic) — a manual goal contribution
// otherwise has zero effect on the monthly budget bar's Remaining figure, which can quietly
// overstate what's actually left to spend. Checking the box also logs it as an Incidental
// (category "Savings") for the current budget month, same $ amount, same date — a linked
// recurring charge's own monthly completion already flows through the reserved-slice math, so
// this only ever applies to the ad-hoc/manual side.
// Returns whether it saved, so the form stays open on a bad amount rather than closing and losing
// the note typed alongside it.
function addGoalContribution(id) {
  const amtEl = document.getElementById('goalContribAmount_' + id);
  const amt = Number(amtEl && amtEl.value);
  if (!amt || amt <= 0) { showToast('Enter an amount first'); return false; }
  const noteEl = document.getElementById('goalContribNote_' + id);
  const note = noteEl ? noteEl.value.trim() : '';
  const countEl = document.getElementById('goalContribCountBudget_' + id);
  const countAgainstBudget = countEl ? countEl.checked : false;
  const g = STATE.budget.goals.find(x => x.id === id);
  if (!g) return false;
  g.contributions.push({ id: uid(), date: todayStr(), amount: amt, note, source: 'manual', countedAgainstBudget: countAgainstBudget });
  if (countAgainstBudget) {
    const key = budgetMonthKey();
    if (!STATE.budget.incidentals[key]) STATE.budget.incidentals[key] = [];
    STATE.budget.incidentals[key].push({ id: uid(), date: todayStr(), amount: amt, category: 'Savings', note: `${g.name} contribution` });
  }
  saveState();
  showToast(countAgainstBudget ? "Contribution logged — counted against this month's budget" : 'Contribution logged');
  return true;
}
function deleteGoalContribution(goalId, contribId) {
  showConfirm('Delete this contribution?', () => {
    const g = STATE.budget.goals.find(x => x.id === goalId);
    if (g) g.contributions = g.contributions.filter(c => c.id !== contribId);
    saveState(); render();
  });
}
// Recurring charges available to link — active, flagged isSavings, and not already claimed by a
// different goal (a charge funds at most one goal, so its monthly contribution never double-counts).
function availableRecurringChargesForGoal(currentGoalId) {
  const claimedByOther = new Set(STATE.budget.goals.filter(g => g.id !== currentGoalId && g.recurringChargeId).map(g => g.recurringChargeId));
  return STATE.budget.recurring.filter(r => r.isSavings && r.active && !claimedByOther.has(r.id));
}
function toggleGoalExpanded(id) { VIEW.goalExpanded = VIEW.goalExpanded === id ? null : id; render(); }
function renderBudgetGoals() {
  const goals = STATE.budget.goals;
  return `<div class="screen">
    <div class="section-title">Goals</div>
    <div style="font-size:12px; color:var(--text-dim); margin:6px 0 14px;">Named savings/investment targets with a running balance — a Roth IRA's annual cap, a down payment, a game console. Fund one by logging contributions here directly, or linking it to an isSavings recurring charge so checking off that month's box on the Recurring tab feeds it automatically.</div>

    <div class="subtle-label" style="margin-bottom:8px;">GOALS</div>
    <div class="panel">
      ${renderGoalFormControls()}
      <div class="stack" style="margin-top:12px;">
        ${goals.length ? goals.map(renderGoalCard).join('') : `<div style="font-size:11px; color:var(--text-faint);">No goals yet — add one above.</div>`}
      </div>
    </div>
  </div>`;
}
// Same shape as FINANCIAL's incidentals (2026-09-18): the button is the resting state and the form
// only exists once you have said you want it. A permanently-open form is three empty fields you
// scroll past every visit to reach the thing you actually came to read.
function renderGoalFormControls() {
  if (!UI.goalFormOpen) {
    return `<button class="btn btn-block" onclick="openGoalForm()"><span class="ic" style="margin-right:6px;">${icon('pencil')}</span>+ ADD GOAL</button>`;
  }
  return `
    <div class="field-row">
      <label class="field"><span class="lbl">Name</span><input type="text" id="goalName" placeholder="e.g. Roth IRA, PS5, Down Payment"></label>
      <label class="field"><span class="lbl">Target ($)</span><input type="number" step="0.01" inputmode="decimal" id="goalTarget" placeholder="0.00"></label>
    </div>
    <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-dim); cursor:pointer; margin-bottom:10px;">
      <input type="checkbox" id="goalResetsAnnually">
      Resets every calendar year — for an annual cap (IRA/Roth-style) rather than a one-time target
    </label>
    <div class="row" style="gap:8px;">
      <button class="btn btn-primary" style="flex:1;" onclick="saveSavingsGoal()">SAVE GOAL</button>
      <button class="btn btn-ghost" onclick="closeGoalForm()">CANCEL</button>
    </div>`;
}
// Keyed by goal id rather than a bare boolean: one goal's contribution form being open must not
// open every other goal's too.
function renderGoalContribControls(g) {
  if (UI.goalContribFormFor !== g.id) {
    return `<button class="btn btn-block" onclick="openGoalContribForm('${g.id}')"><span class="ic" style="margin-right:6px;">${icon('pencil')}</span>+ ADD CONTRIBUTION</button>`;
  }
  return `
    <div class="field-row">
      <label class="field"><span class="lbl">Amount ($)</span><input type="number" step="0.01" inputmode="decimal" id="goalContribAmount_${g.id}" placeholder="0.00"></label>
      <label class="field"><span class="lbl">Note (optional)</span><input type="text" id="goalContribNote_${g.id}" placeholder="Birthday money, sold old one..."></label>
    </div>
    <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-dim); cursor:pointer; margin-bottom:10px;">
      <input type="checkbox" id="goalContribCountBudget_${g.id}">
      Also count against this month's budget (logs as an Incidental too)
    </label>
    <div class="row" style="gap:8px;">
      <button class="btn btn-primary" style="flex:1;" onclick="saveGoalContribution('${g.id}')">SAVE CONTRIBUTION</button>
      <button class="btn btn-ghost" onclick="closeGoalContribForm()">CANCEL</button>
    </div>`;
}
function openGoalContribForm(id) { UI.goalContribFormFor = id; render(); }
function closeGoalContribForm() { UI.goalContribFormFor = null; render(); }
function saveGoalContribution(id) {
  if (addGoalContribution(id)) UI.goalContribFormFor = null;
  render();
}
function openGoalForm() { UI.goalFormOpen = true; render(); }
function closeGoalForm() { UI.goalFormOpen = false; render(); }
function saveSavingsGoal() {
  // Closes only on success, so a missing name leaves what was typed where it was.
  if (addSavingsGoal()) UI.goalFormOpen = false;
  render();
}
function renderGoalCard(g) {
  const progress = goalProgress(g);
  const pct = goalPct(g);
  const complete = goalIsComplete(g);
  const expanded = VIEW.goalExpanded === g.id;
  const linkedCharge = g.recurringChargeId ? STATE.budget.recurring.find(r => r.id === g.recurringChargeId) : null;
  const contribs = goalContributionsInScope(g).slice().sort((a, b) => b.date.localeCompare(a.date));
  return `<div class="panel" ${entityAttr('goal', g.id)} style="${complete ? 'border-color:var(--good);' : ''}">
    <div class="row" style="align-items:flex-start; cursor:pointer;" onclick="toggleGoalExpanded('${g.id}')">
      <div style="flex:1; min-width:0;">
        <div style="font-size:14px; font-weight:700;">${escapeHtml(g.name)}${g.resetsAnnually ? ` <span style="font-size:10px; font-weight:700; color:var(--text-faint);">&middot; ${nowDate().getFullYear()}</span>` : ''}${complete ? ` <span style="color:var(--good); font-size:11px; font-weight:700;">&#10003; COMPLETE</span>` : ''}</div>
        <div style="font-size:12px; color:var(--text-dim); margin-top:2px;">${fmtMoney(progress)} / ${fmtMoney(g.targetAmount)}${linkedCharge ? ` &middot; linked to "${escapeHtml(linkedCharge.name)}"` : ''}</div>
      </div>
      <button class="icon-btn" style="color:var(--bad); flex-shrink:0;" onclick="event.stopPropagation(); deleteSavingsGoal('${g.id}')" title="Delete goal">${icon('close')}</button>
    </div>
    <div class="goal-bar" style="margin-top:10px;">
      <div class="goal-bar-fill ${complete ? 'goal-bar-fill-complete' : ''}" style="width:${pct}%;"></div>
    </div>
    ${expanded ? `
      <div class="divider" style="margin:14px 0;"></div>
      <label class="field"><span class="lbl">Name</span><input type="text" value="${escapeHtml(g.name)}" onchange="updateGoalField('${g.id}','name',this.value)"></label>
      <div class="field-row">
        <label class="field"><span class="lbl">Target ($)</span><input type="number" step="0.01" inputmode="decimal" value="${g.targetAmount || ''}" onchange="updateGoalField('${g.id}','targetAmount',this.value)"></label>
        <label class="field"><span class="lbl">Link to recurring charge</span>
          <select onchange="updateGoalField('${g.id}','recurringChargeId',this.value)">
            <option value="">None (manual only)</option>
            ${availableRecurringChargesForGoal(g.id).map(r => `<option value="${r.id}" ${g.recurringChargeId===r.id?'selected':''}>${escapeHtml(r.name)} (${fmtMoney(r.amount)}/mo)</option>`).join('')}
          </select>
        </label>
      </div>
      <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-dim); cursor:pointer; margin-bottom:12px;">
        <input type="checkbox" ${g.resetsAnnually?'checked':''} onchange="updateGoalField('${g.id}','resetsAnnually',this.checked)">
        Resets every calendar year
      </label>
      ${/* The adder sits UNDER the CONTRIBUTIONS header and above the list, same shape as ADD GOAL:
            a button at rest, the form only once you ask for it. The header names the section; the
            button is the first thing in it. */ ''}
      <div class="subtle-label" style="margin-bottom:8px;">${g.resetsAnnually ? `${nowDate().getFullYear()} ` : ''}CONTRIBUTIONS</div>
      ${renderGoalContribControls(g)}
      <div class="entry-list" style="margin-top:10px;">${contribs.length ? contribs.map(c => renderGoalContributionCard(g.id, c)).join('') : `<div style="font-size:11px; color:var(--text-faint);">Nothing logged yet.</div>`}</div>
    ` : ''}
    ${renderLinkChips('goal', g.id)}
  </div>`;
}
// A recurring-sourced contribution already carries the AUTO badge, which implies budget-linkage
// on its own (it *is* the reserved slice) — a second badge saying the same thing would be noise.
// A manual contribution has no such built-in signal, so it always gets an explicit one either
// way (countedAgainstBudget is undefined on anything logged before this indicator existed, which
// correctly reads as "not counted" — that money genuinely wasn't, there was no checkbox yet).
function renderGoalContributionCard(goalId, c) {
  const budgetBadge = c.source === 'recurring'
    ? ` <span class="savings-badge">${icon('recurDollar')} AUTO</span>`
    : c.countedAgainstBudget
      ? ` <span class="savings-badge">${icon('recurDollar')} IN BUDGET</span>`
      : ` <span style="font-size:10px; color:var(--text-faint); white-space:nowrap;">Not in budget</span>`;
  return `<div class="entry-card">
    <div class="ehead">
      <div><span class="edate">${fmtMoney(c.amount)}</span> <span style="font-size:12px; color:var(--text-dim);">${escapeHtml(c.note || '')}</span>${budgetBadge}</div>
      <button class="icon-btn" onclick="deleteGoalContribution('${goalId}','${c.id}')">${icon('close')}</button>
    </div>
    <div class="estats"><span>${c.date}</span></div>
  </div>`;
}

// Every active recurring income source converted to its monthly-equivalent and summed — the
// steady figure the budget bar starts from each month, replacing the old flat monthlyIncome.
function recurringIncomeMonthlyTotal() {
  return STATE.budget.recurringIncome.filter(r => r.active).reduce((s, r) => {
    const freq = INCOME_FREQUENCIES[r.frequency] || INCOME_FREQUENCIES.monthly;
    return s + (Number(r.amount) || 0) * freq.perMonth;
  }, 0);
}
function budgetTotalIncome(key) {
  return recurringIncomeMonthlyTotal() + budgetAdditionalIncomeTotal(key);
}

// ---- Recurring income sources (config-style: always-editable rows, like recurring charges) ----
// Returns whether it saved; saveIncomeSource() closes the form only on true.
function addRecurringIncome() {
  const nameEl = document.getElementById('incName');
  const name = nameEl ? nameEl.value.trim() : '';
  const amountEl = document.getElementById('incAmount');
  const amount = Number(amountEl && amountEl.value);
  if (!name) { showToast('Give it a name'); return false; }
  if (!amount || amount <= 0) { showToast('Enter an amount first'); return false; }
  const frequency = inputVal('incFrequency') || 'monthly';
  STATE.budget.recurringIncome.push({ id: uid(), name, amount, frequency, active: true });
  saveState();
  showToast('Income source added');
  return true;
}
function updateRecurringIncomeField(id, field, value) {
  const r = STATE.budget.recurringIncome.find(x => x.id === id);
  if (!r) return;
  if (field === 'amount') r.amount = Number(value) || 0;
  else if (field === 'name') r.name = value.trim();
  else r.frequency = value;
  saveState();
  render();
}
function toggleRecurringIncomeActive(id, checked) {
  const r = STATE.budget.recurringIncome.find(x => x.id === id);
  if (!r) return;
  r.active = checked;
  saveState();
  render();
}
function deleteRecurringIncome(id) {
  showConfirm('Delete this income source?', () => {
    STATE.budget.recurringIncome = STATE.budget.recurringIncome.filter(x => x.id !== id);
    saveState(); render();
  });
}
// An income source at REST is a readout: name, amount, frequency, and nothing you can type into.
// Editing is a mode you enter from the pencil (2026-09-18) -- the same call made for Notes, and for
// the same reason: a row of live inputs invites an accidental edit to a number the budget bar is
// computed from, and reads as unfinished rather than as data.
//
// The one exception is ACTIVE, which stays a live checkbox in both modes. Turning a source off for
// a month is the thing you do most often here and it is instantly reversible, so putting it behind
// the pencil would cost two taps to save nothing. Explicitly asked for.
function renderRecurringIncomeRow(r) {
  const editing = UI.incomeSourceEditing === r.id;
  const freq = (INCOME_FREQUENCIES[r.frequency] || INCOME_FREQUENCIES.monthly).label;
  const activeToggle = `
    <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-dim); cursor:pointer;">
      <input type="checkbox" ${r.active ? 'checked' : ''} onchange="toggleRecurringIncomeActive('${r.id}', this.checked)">
      Active — counts toward this month's income
    </label>`;
  if (!editing) {
    return `<div class="entry-card" style="${r.active ? '' : 'opacity:0.5;'}">
      <div class="ehead">
        <div style="min-width:0;">
          <div style="font-size:14px; font-weight:700;">${escapeHtml(r.name)}</div>
          <div style="font-size:12px; color:var(--text-dim); margin-top:2px;">
            <span class="mono">${fmtMoney(r.amount)}</span> &middot; ${escapeHtml(freq)}</div>
        </div>
        <button class="icon-btn" onclick="editIncomeSource('${r.id}')" title="Edit this source" aria-label="Edit this source">${icon('pencil')}</button>
      </div>
      ${activeToggle}
    </div>`;
  }
  return `<div class="entry-card" style="border-color:var(--accent);">
    <div class="ehead">
      <input type="text" value="${escapeHtml(r.name)}" placeholder="e.g. Paycheck" style="font-weight:700; font-size:14px; border:none; background:transparent; padding:0; color:var(--text); font-family:var(--font-body);" onchange="updateRecurringIncomeField('${r.id}','name',this.value)">
      <button class="icon-btn" style="color:var(--bad);" onclick="deleteRecurringIncome('${r.id}')" title="Delete this source">${icon('close')}</button>
    </div>
    <div class="field-row">
      <label class="field"><span class="lbl">Amount</span><input type="number" step="0.01" inputmode="decimal" value="${r.amount || ''}" onchange="updateRecurringIncomeField('${r.id}','amount',this.value)"></label>
      <label class="field"><span class="lbl">Frequency</span><select onchange="updateRecurringIncomeField('${r.id}','frequency',this.value)">${incomeFrequencyOptions(r.frequency)}</select></label>
    </div>
    ${activeToggle}
    ${/* DONE rather than SAVE: every field here commits on change, so there is nothing held back
          waiting for a button. Calling it SAVE would imply there is. */ ''}
    <button class="btn btn-ghost btn-sm btn-block" style="margin-top:10px;" onclick="closeIncomeSourceEdit()">DONE</button>
  </div>`;
}
function editIncomeSource(id) { UI.incomeSourceEditing = id; render(); }
function closeIncomeSourceEdit() { UI.incomeSourceEditing = null; render(); }
// The adder, matching ADD GOAL and ADD CONTRIBUTION: a button at rest, the form on request.
function renderIncomeSourceControls() {
  if (!UI.incomeSourceFormOpen) {
    return `<button class="btn btn-block" onclick="openIncomeSourceForm()"><span class="ic" style="margin-right:6px;">${icon('pencil')}</span>+ ADD SOURCE</button>`;
  }
  return `
    <div class="field-row">
      <label class="field"><span class="lbl">Name</span><input type="text" id="incName" placeholder="e.g. Paycheck"></label>
      <label class="field"><span class="lbl">Amount</span><input type="number" step="0.01" inputmode="decimal" id="incAmount" placeholder="0.00"></label>
    </div>
    <label class="field"><span class="lbl">Frequency</span><select id="incFrequency">${incomeFrequencyOptions('monthly')}</select></label>
    <div class="row" style="gap:8px;">
      <button class="btn btn-primary" style="flex:1;" onclick="saveIncomeSource()">SAVE SOURCE</button>
      <button class="btn btn-ghost" onclick="closeIncomeSourceForm()">CANCEL</button>
    </div>`;
}
function openIncomeSourceForm() { UI.incomeSourceFormOpen = true; render(); }
function closeIncomeSourceForm() { UI.incomeSourceFormOpen = false; render(); }
function saveIncomeSource() {
  if (addRecurringIncome()) UI.incomeSourceFormOpen = false;
  render();
}

// ---- Savings & Investment planning: enter either a flat $ amount or a % of recurring income --
// whichever field was last edited (`savingsPlan.mode`) is the source of truth; the other is
// always derived live against recurringIncomeMonthlyTotal(), so it stays current as income
// sources change rather than going stale. This is a planning/target figure only -- separate
// from actually flagging a specific recurring charge isSavings (which reserves real committed
// spending in the budget bar); this is "how much should I be aiming for".
function updateSavingsPlan(mode, value) {
  STATE.budget.savingsPlan = { mode, value: value === '' ? null : Number(value) };
  saveState();
  render();
}
function renderSavingsPlanSection() {
  const plan = STATE.budget.savingsPlan || { mode: 'percent', value: null };
  const monthlyIncome = recurringIncomeMonthlyTotal();
  const pct = plan.mode === 'percent' ? plan.value : (monthlyIncome > 0 && plan.value != null ? (plan.value / monthlyIncome * 100) : null);
  const amt = plan.mode === 'amount' ? plan.value : (plan.value != null ? (monthlyIncome * plan.value / 100) : null);
  const amtVal = plan.mode === 'amount' ? (plan.value ?? '') : (amt != null ? Math.round(amt * 100) / 100 : '');
  const pctVal = plan.mode === 'percent' ? (plan.value ?? '') : (pct != null ? Math.round(pct * 10) / 10 : '');
  return `
    <div class="subtle-label" style="margin:18px 0 8px;">SAVINGS &amp; INVESTMENT PLANNING</div>
    <div class="panel">
      <div class="field-row">
        <label class="field"><span class="lbl">Amount ($/mo)</span><input type="number" step="0.01" inputmode="decimal" placeholder="0.00" value="${amtVal}" onchange="updateSavingsPlan('amount', this.value)"></label>
        <label class="field"><span class="lbl">% of Income</span><input type="number" step="0.1" inputmode="decimal" placeholder="0" value="${pctVal}" onchange="updateSavingsPlan('percent', this.value)"></label>
      </div>
      <div style="font-size:11px; color:var(--text-faint);">${monthlyIncome > 0 ? `Based on ${fmtMoney(monthlyIncome)}/mo recurring income — enter either field and the other updates to match.` : 'Add a recurring income source above to plan against a real monthly figure.'}</div>
    </div>`;
}
// One-off, non-recurring income logged as it happens (a bonus, a gift, freelance income for the
// month) — distinct from recurringIncome's steady named sources above.
// ---- One incidental, either direction ----
//
// Money arriving and money leaving were two panels with two forms, stacked at opposite ends of the
// screen. They are the same act -- something happened this month that isn't recurring -- so they
// are one container now (2026-09-18): two buttons choose the DIRECTION, and the form underneath is
// whichever one that direction needs.
//
// The two STORES stay separate (STATE.budget.incomeLog and .incidentals). Merging them would be a
// migration on real money for a screen-layout reason, and the bar already reads both. What merges
// is the list you read them in -- see renderBudgetLedger().
function openBudgetIncidental(kind) { UI.budgetIncidentalForm = kind; render(); }
function closeBudgetIncidental() { UI.budgetIncidentalForm = null; render(); }
function saveBudgetIncidental() {
  const kind = UI.budgetIncidentalForm;
  // The writers return false and leave the form alone when there is nothing to save, so a mistyped
  // amount does not silently close the form and lose the rest of what was typed.
  const ok = kind === 'income' ? addBudgetIncome() : addBudgetIncidental();
  if (ok) UI.budgetIncidentalForm = null;
  render();
}
// Adding and reading are ONE container (2026-09-18): the buttons, then the two ledgers they feed.
// They were a panel and a loose list with a heading between them, which read as two unrelated
// things when they are the same subject -- what happened this month outside your recurring lines.
// Returns the controls only; renderBudgetHome() wraps these and the ledgers in the single panel.
function renderBudgetIncidentalControls() {
  const kind = UI.budgetIncidentalForm;
  if (!kind) {
    return `
      <div class="field-row" style="margin-bottom:0;">
        <button class="btn btn-block btn-good" onclick="openBudgetIncidental('income')">+ ADD INCOME</button>
        <button class="btn btn-block" onclick="openBudgetIncidental('charge')">+ ADD CHARGE</button>
      </div>`;
  }
  return `
    <div class="subtle-label" style="margin-bottom:8px; color:${kind === 'income' ? 'var(--good)' : 'var(--text-dim)'};">
      ${kind === 'income' ? 'INCOME' : 'CHARGE'}</div>
    ${kind === 'income' ? renderBudgetIncomeFields() : renderBudgetChargeFields()}
    <div class="row" style="gap:8px; margin-top:10px;">
      <button class="btn btn-primary" style="flex:1;" onclick="saveBudgetIncidental()">SAVE INCIDENTAL</button>
      <button class="btn btn-ghost" onclick="closeBudgetIncidental()">CANCEL</button>
    </div>`;
}
function renderBudgetIncomeFields() {
  return `
    <div class="field-row">
      <label class="field"><span class="lbl">Amount</span><input type="number" step="0.01" inputmode="decimal" id="budgetIncomeAmount" placeholder="0.00"></label>
      <label class="field"><span class="lbl">Source</span><input type="text" id="budgetIncomeSource" placeholder="e.g. Freelance, bonus, gift"></label>
    </div>`;
}
function renderBudgetChargeFields() {
  return `
    <div class="field-row">
      <label class="field"><span class="lbl">Amount</span><input type="number" step="0.01" inputmode="decimal" id="budgetIncAmount" placeholder="0.00"></label>
      <label class="field"><span class="lbl">Category</span><select id="budgetIncCategory">${budgetCategoryOptions('Other')}</select></label>
    </div>
    <label class="field" style="margin-bottom:0;"><span class="lbl">Note (optional)</span><input type="text" id="budgetIncNote" placeholder="What was it for?"></label>`;
}
// Returns whether it saved, so the container knows whether to close. Does NOT render -- its caller
// does, once, after deciding.
function addBudgetIncome() {
  const amtEl = document.getElementById('budgetIncomeAmount');
  const amt = Number(amtEl && amtEl.value);
  if (!amt || amt <= 0) { showToast('Enter an amount first'); return false; }
  const sourceEl = document.getElementById('budgetIncomeSource');
  const source = sourceEl ? sourceEl.value.trim() : '';
  const key = budgetMonthKey();
  if (!STATE.budget.incomeLog[key]) STATE.budget.incomeLog[key] = [];
  STATE.budget.incomeLog[key].push({ id: uid(), date: todayStr(), amount: amt, source: source || 'Additional income' });
  saveState();
  showToast('Income added');
  return true;
}
function deleteBudgetIncome(key, id) {
  showConfirm('Delete this income entry?', () => {
    STATE.budget.incomeLog[key] = (STATE.budget.incomeLog[key] || []).filter(e => e.id !== id);
    saveState(); render();
  });
}
function renderBudgetIncomeCard(e, key) {
  return `<div class="entry-card">
    <div class="ehead">
      ${/* The leading + and the good colour are the only things separating an income row from a
            charge row now that both share one ledger. Direction is the single most important thing
            about a money row, so it is carried by colour AND by a glyph, not by colour alone. */ ''}
      <div><span class="edate" style="color:var(--good);">+${fmtMoney(e.amount)}</span> <span style="font-size:12px; color:var(--text-dim);">${escapeHtml(e.source || '')}</span></div>
      <button class="icon-btn" onclick="deleteBudgetIncome('${key}','${e.id}')">${icon('close')}</button>
    </div>
    <div class="estats"><span>${e.date}</span></div>
  </div>`;
}

// ---- Incidentals (logged as they happen) ----
function addBudgetIncidental() {
  const amtEl = document.getElementById('budgetIncAmount');
  const amt = Number(amtEl && amtEl.value);
  if (!amt || amt <= 0) { showToast('Enter an amount first'); return false; }
  const category = inputVal('budgetIncCategory') || 'Other';
  const noteEl = document.getElementById('budgetIncNote');
  const note = noteEl ? noteEl.value.trim() : '';
  const key = budgetMonthKey();
  if (!STATE.budget.incidentals[key]) STATE.budget.incidentals[key] = [];
  STATE.budget.incidentals[key].push({ id: uid(), date: todayStr(), amount: amt, category, note });
  saveState();
  showToast('Incidental logged');
  return true;
}
// One ledger per DIRECTION, each behind its own caret. The totals sit on the closed headers, which
// is the whole point of the .disclose shape -- you read the answer without opening anything, and
// open only the side you want to itemise. A single merged list was tried first and put money in and
// money out in one column, where a row's direction was carried by a `+` you had to notice.
//
// Closed by default, both of them: the month's two numbers are the thing you came to see, and the
// rows behind them are the follow-up question.
function toggleBudgetLedger(kind) {
  const open = UI.budgetLedgerOpen || (UI.budgetLedgerOpen = { income: false, charge: false });
  open[kind] = !open[kind];
  render();
}
function renderBudgetLedgerGroup(kind, key) {
  const open = (UI.budgetLedgerOpen || {})[kind];
  const income = kind === 'income';
  const rows = (income ? budgetIncomeEntriesForMonth(key) : budgetIncidentalsForMonth(key))
    .slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const total = rows.reduce((n, e) => n + (Number(e.amount) || 0), 0);
  return `
    <div style="margin-top:12px;">
      ${/* .disclose-row, not the plain .disclose: these two headers ARE the section when closed, so
            they have to look pressable rather than like a label with a small mark beside them. The
            count is what says there is detail behind the caret at all. */ ''}
      <button class="disclose disclose-row" onclick="toggleBudgetLedger('${kind}')" aria-expanded="${!!open}">
        <span class="disclose-caret">${open ? '&#9662;' : '&#9656;'}</span>
        <span class="disclose-label"${income ? ' style="color:var(--good);"' : ''}>${income ? 'INCOME' : 'CHARGES'}</span>
        <span class="disclose-count">${rows.length ? `${rows.length} ${rows.length === 1 ? 'ENTRY' : 'ENTRIES'}` : 'NONE'}</span>
        <span class="disclose-value mono"${income ? ' style="color:var(--good);"' : ''}>${income ? '+' : ''}${fmtMoney(total)}</span>
      </button>
      ${open ? `<div class="entry-list" style="margin-top:10px;">${rows.length
        ? rows.map(e => income ? renderBudgetIncomeCard(e, key) : renderBudgetIncidentalCard(e, key)).join('')
        : `<div style="font-size:11px; color:var(--text-faint);">Nothing logged this month.</div>`}</div>` : ''}
    </div>`;
}
function deleteBudgetIncidental(key, id) {
  showConfirm('Delete this incidental?', () => {
    STATE.budget.incidentals[key] = (STATE.budget.incidentals[key] || []).filter(e => e.id !== id);
    saveState(); render();
  });
}
function renderBudgetIncidentalCard(e, key) {
  return `<div class="entry-card">
    <div class="ehead">
      <div>${budgetCategoryChip(e.category)}<span class="edate">${fmtMoney(e.amount)}</span></div>
      <button class="icon-btn" onclick="deleteBudgetIncidental('${key}','${e.id}')">${icon('close')}</button>
    </div>
    <div class="estats"><span>${e.date}</span>${e.note ? `<span>${escapeHtml(e.note)}</span>` : ''}</div>
  </div>`;
}

// ---- Recurring charges (config-style: always-editable rows, like the rest of Setup) ----
// Returns whether it saved; saveRecurringCharge() closes the form only on true.
function addRecurringCharge() {
  const nameEl = document.getElementById('recName');
  const name = nameEl ? nameEl.value.trim() : '';
  const amountEl = document.getElementById('recAmount');
  const amount = Number(amountEl && amountEl.value);
  if (!name) { showToast('Give it a name'); return false; }
  if (!amount || amount <= 0) { showToast('Enter an amount first'); return false; }
  const category = inputVal('recCategory') || 'Other';
  const isSavings = inputChecked('recIsSavings');
  STATE.budget.recurring.push({ id: uid(), name, amount, category, active: true, isSavings, dueDay: null, reminderRecurrenceId: null });
  saveState();
  showToast('Recurring charge added');
  return true;
}
function updateRecurringField(id, field, value) {
  const r = STATE.budget.recurring.find(x => x.id === id);
  if (!r) return;
  if (field === 'amount') r.amount = Number(value) || 0;
  else if (field === 'name') r.name = value.trim();
  else if (field === 'dueDay') {
    const n = Math.round(Number(value));
    r.dueDay = (n >= 1 && n <= 31) ? n : null;
    // The due date is central to what the reminder IS, unlike name/amount below -- if it changes,
    // the existing series is simply describing the wrong day and has to be rebuilt, not patched.
    if (r.reminderRecurrenceId) resyncChargeReminder(r);
  }
  else r.category = value;
  saveState();
  render();
}
// Deletes every reminder in a series by id, regardless of which field it's keyed by -- the one
// piece shared by disableChargeReminder(), resyncChargeReminder() and deleteRecurringCharge()'s
// own cleanup, so there's exactly one place that knows "a series is every row with this
// recurrenceId" rather than three copies of that filter drifting apart.
function deleteReminderSeries(recurrenceId) {
  if (!recurrenceId) return;
  STATE.reminders = STATE.reminders.filter(r => r.recurrenceId !== recurrenceId);
}
// The next occurrence of dueDay from today -- this month's if it hasn't passed yet, otherwise
// next month's. Mirrors what "add a recurring reminder starting now" means for any other
// recurring reminder, just computed from a day-of-month rather than a picked calendar date.
function nextChargeDueDate(dueDay) {
  const today = todayStr();
  const now = new Date(today + 'T00:00:00');
  const thisMonth = dateKey(now.getFullYear(), now.getMonth(), Math.min(dueDay, daysInMonthOf(now)));
  return thisMonth >= today ? thisMonth : addMonthsClamped(thisMonth, 1);
}
function enableChargeReminder(id) {
  const r = STATE.budget.recurring.find(x => x.id === id);
  if (!r || !r.dueDay) { showToast('Set a due day first'); return; }
  const anchor = nextChargeDueDate(r.dueDay);
  const rid = uid();
  STATE.reminders.push({
    id: rid, date: anchor, time: STATE.settings.defaultReminderTime || '09:00', endTime: null,
    title: `${r.name} due`, notes: fmtMoney(r.amount), createdAt: Date.now(), type: 'reminder',
    recurrence: 'monthly', recurrenceId: rid, anchorDate: anchor,
    // Always carries dueDate, same rule saveReminder() uses for any recurring reminder -- see its
    // comment. Same-day by default (leadDays null); the charge row's own input can raise it.
    dueDate: anchor, leadDays: null,
  });
  r.reminderRecurrenceId = rid;
  saveState();
  ensureRecurringReminderOccurrences(); // materializes the rest of the series right away
  queueReminderPushSync();
  showToast('Reminder created');
  render();
}
function disableChargeReminder(id) {
  const r = STATE.budget.recurring.find(x => x.id === id);
  if (!r) return;
  deleteReminderSeries(r.reminderRecurrenceId);
  r.reminderRecurrenceId = null;
  saveState();
  queueReminderPushSync();
  render();
}
// Delete-and-recreate rather than patch-in-place: the series' anchor (and therefore every future
// occurrence) is derived from dueDay, so a changed dueDay makes the whole existing series wrong,
// not just its next row. Whatever lead time was set carries over to the fresh series.
function resyncChargeReminder(charge) {
  const oldSeries = STATE.reminders.filter(r => r.recurrenceId === charge.reminderRecurrenceId);
  const leadDays = (oldSeries[0] && oldSeries[0].leadDays) || 0;
  deleteReminderSeries(charge.reminderRecurrenceId);
  charge.reminderRecurrenceId = null;
  if (!charge.dueDay) return; // dueDay was cleared entirely -- nothing to rebuild
  enableChargeReminder(charge.id);
  if (leadDays > 0) updateChargeReminderLead(charge.id, leadDays);
}
// The lead time lives on the reminder series, not the charge -- editing it touches every row in
// the series. Every row already carries its own dueDate (see enableChargeReminder() /
// ensureRecurringReminderOccurrences()), so this only ever has to recompute `date` from it -- no
// need to re-derive which occurrence a row is or recompute its due date from scratch.
function updateChargeReminderLead(id, val) {
  const r = STATE.budget.recurring.find(x => x.id === id);
  if (!r || !r.reminderRecurrenceId) return;
  const leadDays = Math.max(0, Math.round(Number(val)) || 0);
  STATE.reminders.filter(x => x.recurrenceId === r.reminderRecurrenceId).forEach(x => {
    x.date = computeLeadDates(x.dueDate, leadDays).date;
    x.leadDays = leadDays || null;
  });
  saveState();
  queueReminderPushSync();
  render();
}
function toggleRecurringActive(id, checked) {
  const r = STATE.budget.recurring.find(x => x.id === id);
  if (!r) return;
  r.active = checked;
  saveState();
  render();
}
function toggleRecurringSavings(id, checked) {
  const r = STATE.budget.recurring.find(x => x.id === id);
  if (!r) return;
  r.isSavings = checked;
  saveState();
  render();
}
function deleteRecurringCharge(id) {
  showConfirm('Delete this recurring charge?', () => {
    const charge = STATE.budget.recurring.find(x => x.id === id);
    // Deleting the charge without this orphans a monthly-recurring reminder forever -- there'd be
    // nothing left pointing at it to ever clean it up, and it would keep pushing about a charge
    // that no longer exists.
    if (charge && charge.reminderRecurrenceId) deleteReminderSeries(charge.reminderRecurrenceId);
    STATE.budget.recurring = STATE.budget.recurring.filter(x => x.id !== id);
    // A goal linked to this charge keeps its already-logged contribution history — only the
    // now-dangling link itself is cleared, same as any other delete-the-thing-it-points-to case.
    const linkedGoal = STATE.budget.goals.find(g => g.recurringChargeId === id);
    if (linkedGoal) linkedGoal.recurringChargeId = null;
    saveState(); queueReminderPushSync(); render();
  });
}
// Same two modes as an income source, for the same reasons -- and because these two sit on one
// screen, so one of them staying a wall of live inputs would just look unfinished. ACTIVE stays
// live in both modes here too; the savings flag and the due date are settings you set once, so they
// live behind the pencil.
function renderRecurringRow(r) {
  const editing = UI.recurringChargeEditing === r.id;
  const activeToggle = `
    <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-dim); cursor:pointer;">
      <input type="checkbox" ${r.active ? 'checked' : ''} onchange="toggleRecurringActive('${r.id}', this.checked)">
      Active — counts toward the reserved slice of this month's bar
    </label>`;
  if (!editing) {
    return `<div class="entry-card" ${entityAttr('charge', r.id)} style="${r.active ? '' : 'opacity:0.5;'} ${r.isSavings ? 'border-color:var(--savings);' : ''}">
      <div class="ehead">
        <div style="min-width:0;">
          <div style="font-size:14px; font-weight:700;">${r.isSavings ? `<span class="savings-badge">${icon('recurDollar')} SAVINGS</span>` : ''}${escapeHtml(r.name)}</div>
          <div style="font-size:12px; color:var(--text-dim); margin-top:2px;">
            <span class="mono">${fmtMoney(r.amount)}</span>${r.category ? ` &middot; ${escapeHtml(r.category)}` : ''}</div>
        </div>
        <button class="icon-btn" onclick="editRecurringCharge('${r.id}')" title="Edit this charge" aria-label="Edit this charge">${icon('pencil')}</button>
      </div>
      ${activeToggle}
      ${renderLinkChips('charge', r.id)}
    </div>`;
  }
  return `<div class="entry-card" ${entityAttr('charge', r.id)} style="border-color:var(--accent);">
    <div class="ehead">
      <div>${r.isSavings ? `<span class="savings-badge">${icon('recurDollar')} SAVINGS</span>` : ''}<input type="text" value="${escapeHtml(r.name)}" placeholder="e.g. Rent" style="font-weight:700; font-size:14px; border:none; background:transparent; padding:0; color:var(--text); font-family:var(--font-body);" onchange="updateRecurringField('${r.id}','name',this.value)"></div>
      <button class="icon-btn" style="color:var(--bad);" onclick="deleteRecurringCharge('${r.id}')" title="Delete this charge">${icon('close')}</button>
    </div>
    <div class="field-row">
      <label class="field"><span class="lbl">Amount</span><input type="number" step="0.01" inputmode="decimal" value="${r.amount || ''}" onchange="updateRecurringField('${r.id}','amount',this.value)"></label>
      <label class="field"><span class="lbl">Category</span><select onchange="updateRecurringField('${r.id}','category',this.value)">${budgetCategoryOptions(r.category)}</select></label>
    </div>
    ${activeToggle}
    <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--savings); cursor:pointer; margin-top:6px;">
      <input type="checkbox" ${r.isSavings ? 'checked' : ''} onchange="toggleRecurringSavings('${r.id}', this.checked)">
      Savings / Investment — money you're paying yourself, not spending
    </label>
    ${renderChargeDueSection(r)}
    ${renderLinkChips('charge', r.id)}
    <button class="btn btn-ghost btn-sm btn-block" style="margin-top:10px;" onclick="closeRecurringChargeEdit()">DONE</button>
  </div>`;
}
function editRecurringCharge(id) { UI.recurringChargeEditing = id; render(); }
function closeRecurringChargeEdit() { UI.recurringChargeEditing = null; render(); }
function renderRecurringChargeControls() {
  if (!UI.recurringChargeFormOpen) {
    return `<button class="btn btn-block" onclick="openRecurringChargeForm()"><span class="ic" style="margin-right:6px;">${icon('pencil')}</span>+ ADD CHARGE</button>`;
  }
  return `
    <div class="field-row">
      <label class="field"><span class="lbl">Name</span><input type="text" id="recName" placeholder="e.g. Rent"></label>
      <label class="field"><span class="lbl">Amount</span><input type="number" step="0.01" inputmode="decimal" id="recAmount" placeholder="0.00"></label>
    </div>
    <label class="field"><span class="lbl">Category</span><select id="recCategory">${budgetCategoryOptions('Housing')}</select></label>
    <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--savings); cursor:pointer; margin-bottom:10px;">
      <input type="checkbox" id="recIsSavings">
      Savings / Investment — money you're paying yourself, not spending
    </label>
    <div class="row" style="gap:8px;">
      <button class="btn btn-primary" style="flex:1;" onclick="saveRecurringCharge()">SAVE CHARGE</button>
      <button class="btn btn-ghost" onclick="closeRecurringChargeForm()">CANCEL</button>
    </div>`;
}
function openRecurringChargeForm() { UI.recurringChargeFormOpen = true; render(); }
function closeRecurringChargeForm() { UI.recurringChargeFormOpen = false; render(); }
function saveRecurringCharge() {
  if (addRecurringCharge()) UI.recurringChargeFormOpen = false;
  render();
}
// The due day + optional reminder, split out from renderRecurringRow() since it's the one part of
// the card with its own internal show/hide logic (the remind-me toggle and its lead-time field
// only make sense once a due day exists).
function renderChargeDueSection(r) {
  const linkedReminder = r.reminderRecurrenceId ? STATE.reminders.find(x => x.recurrenceId === r.reminderRecurrenceId) : null;
  return `
    <div class="field-row" style="margin-top:10px;">
      <label class="field" style="max-width:120px;"><span class="lbl">Due day (optional)</span><input type="number" min="1" max="31" step="1" value="${r.dueDay || ''}" placeholder="e.g. 3" onchange="updateRecurringField('${r.id}','dueDay',this.value)"></label>
    </div>
    ${!r.dueDay ? '' : `
    <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-dim); cursor:pointer; margin-top:2px;">
      <input type="checkbox" ${r.reminderRecurrenceId ? 'checked' : ''} onchange="this.checked ? enableChargeReminder('${r.id}') : disableChargeReminder('${r.id}')">
      Remind me &mdash; a monthly reminder, editable like any other, with push notifications if you've enabled those in Settings
    </label>
    ${!linkedReminder ? '' : `
    <div class="field-row" style="margin-top:6px; align-items:flex-end;">
      <label class="field" style="max-width:140px;"><span class="lbl">Remind me early (days before)</span><input type="number" min="0" step="1" value="${linkedReminder.leadDays || ''}" placeholder="0" onchange="updateChargeReminderLead('${r.id}',this.value)"></label>
    </div>`}`}`;
}

// ---- Savings progress: one row per active isSavings recurring charge, checked off once
// contributed for the current month. This is what actually moves budgetRecurringSavingsCompletedTotal()
// and, in turn, the solid fill layer on the budget bar's savings slice.
function renderSavingsProgressSection(key) {
  const savingsCharges = STATE.budget.recurring.filter(r => r.active && r.isSavings);
  if (!savingsCharges.length) return '';
  const completedTotal = budgetRecurringSavingsCompletedTotal(key);
  const plannedTotal = budgetRecurringSavingsTotal();
  return `
    <div class="row" style="margin:18px 0 8px;">
      <div class="subtle-label" style="margin-bottom:0;">SAVINGS PROGRESS</div>
      <span class="mono" style="font-size:13px; font-weight:700; color:var(--savings);">${fmtMoney(completedTotal)} / ${fmtMoney(plannedTotal)}</span>
    </div>
    <div class="panel">
      ${savingsCharges.map(r => `<label style="display:flex; align-items:center; gap:8px; font-size:13px; padding:5px 0; cursor:pointer;">
        <input type="checkbox" ${isSavingsCompletedForMonth(key, r.id) ? 'checked' : ''} onchange="toggleSavingsCompletion('${key}','${r.id}', this.checked)">
        <span style="flex:1;">${escapeHtml(r.name)}</span>
        <span class="mono" style="color:var(--text-dim);">${fmtMoney(r.amount)}</span>
      </label>`).join('')}
      <div style="font-size:11px; color:var(--text-faint); margin-top:6px;">Check off each contribution as you actually make it — the savings slice of the bar above fills in to match.</div>
    </div>`;
}
// ---- The budget bar: income width, a red line marking the recurring-reserved slice, and a
// growing fill for incidentals logged so far. Percentages are clamped purely for the visual
// (a maxed-out bar), while the remaining/over-budget text always uses the real dollar totals.
// The savings slice is itself two-layer: a light outline for the full planned allocation
// (every active isSavings charge) with a solid fill on top that grows as those charges get
// checked off as contributed for the month (see budgetRecurringSavingsCompletedTotal() /
// toggleSavingsCompletion()) — a real goal-progress fill, not just a flat reserved block.
function renderBudgetBar(key) {
  const totalIncome = budgetTotalIncome(key);
  const recurringTotal = budgetRecurringTotal();
  const recurringExpenseTotal = budgetRecurringExpenseTotal();
  const recurringSavingsTotal = budgetRecurringSavingsTotal();
  const recurringSavingsCompleted = budgetRecurringSavingsCompletedTotal(key);
  const incidentalsTotal = budgetIncidentalsTotal(key);
  const remaining = totalIncome - recurringTotal - incidentalsTotal;
  const overBudget = remaining < 0;
  const safeIncome = totalIncome > 0 ? totalIncome : 1;
  const recurringExpensePct = totalIncome > 0 ? Math.max(0, Math.min(100, recurringExpenseTotal / safeIncome * 100)) : 0;
  const recurringSavingsPct = totalIncome > 0 ? Math.max(0, Math.min(100 - recurringExpensePct, recurringSavingsTotal / safeIncome * 100)) : 0;
  const recurringSavingsFillPct = recurringSavingsTotal > 0 ? Math.max(0, Math.min(recurringSavingsPct, recurringSavingsCompleted / safeIncome * 100)) : 0;
  const recurringPct = recurringExpensePct + recurringSavingsPct;
  const incidentalsPct = totalIncome > 0 ? Math.max(0, Math.min(100 - recurringPct, incidentalsTotal / safeIncome * 100)) : 0;
  const baseIncome = recurringIncomeMonthlyTotal();
  const extraIncome = totalIncome - baseIncome;

  return `
    <div style="margin-bottom:14px;">
      <div style="font-size:11px; color:var(--text-faint); font-weight:700; letter-spacing:0.04em;">TOTAL INCOME THIS MONTH</div>
      <div style="font-family:var(--font-head); font-size:32px; font-weight:800;">${fmtMoney(totalIncome)}</div>
      <div style="font-size:11px; color:var(--text-faint);">${totalIncome <= 0 ? 'Add a recurring income source on the Recurring tab to get started.' : `Recurring ${fmtMoney(baseIncome)}${extraIncome ? ` + Extra ${fmtMoney(extraIncome)}` : ''}`}</div>
    </div>
    <div class="budget-bar ${overBudget ? 'budget-bar-over' : ''}">
      <div class="budget-bar-recurring" style="width:${recurringExpensePct}%;"></div>
      <div class="budget-bar-savings" style="left:${recurringExpensePct}%; width:${recurringSavingsPct}%;"></div>
      ${recurringSavingsFillPct > 0 ? `<div class="budget-bar-savings-fill" style="left:${recurringExpensePct}%; width:${recurringSavingsFillPct}%;" title="Contributed so far: ${fmtMoney(recurringSavingsCompleted)} of ${fmtMoney(recurringSavingsTotal)}"></div>` : ''}
      <div class="budget-bar-incidentals" style="left:${recurringPct}%; width:${incidentalsPct}%;"></div>
      ${recurringPct > 0 ? `<div class="budget-bar-line" style="left:${recurringPct}%;" title="Recurring charges: ${fmtMoney(recurringTotal)}"></div>` : ''}
    </div>
    <div class="budget-bar-legend">
      <span><i class="budget-dot" style="background:var(--bad);"></i>Recurring <b>${fmtMoney(recurringExpenseTotal)}</b></span>
      ${recurringSavingsTotal > 0 ? `<span><i class="budget-dot" style="background:var(--savings);"></i>Savings/Invest <b>${fmtMoney(recurringSavingsCompleted)} / ${fmtMoney(recurringSavingsTotal)}</b></span>` : ''}
      <span><i class="budget-dot" style="background:var(--accent);"></i>Incidentals <b>${fmtMoney(incidentalsTotal)}</b></span>
      <span>${overBudget ? `<b style="color:var(--bad);">${fmtMoney(Math.abs(remaining))} over budget</b>` : `Remaining <b style="color:var(--good);">${fmtMoney(remaining)}</b>`}</span>
    </div>`;
}

// ---- Screens ----
function renderBudgetHome() {
  ensureBudgetMonth();
  const key = budgetMonthKey();
  const monthLabel = `${MONTH_NAMES[NAV.budgetMonth.month]} ${NAV.budgetMonth.year}`;
  const incidentalsTotal = budgetIncidentalsTotal(key);
  // Both directions in the header, because the list below now holds both. Showing only the "out"
  // total over a list containing income reads as a wrong sum rather than a partial one.
  const extraIncomeTotal = budgetIncomeEntriesForMonth(key).reduce((n, e) => n + (Number(e.amount) || 0), 0);

  // THIS MONTH'S FINANCIALS leads (2026-09-18). It is the answer the screen exists to give, and it
  // used to sit third, under two forms — so opening FINANCIAL showed you a pair of empty inputs and
  // made you scroll to find out how the month was going.
  //
  // The RECURRING INCOME and RECURRING CHARGES panels are gone from here. They restated totals the
  // bar above already draws, and the bar draws them as PROPORTIONS, which is the useful form. The
  // lists themselves live on the RECURRING subtab, which is one tap away and is where you would go
  // to change one anyway.
  return `<div class="screen">
    <div class="week-selector" style="margin-bottom:14px;">
      <div class="cycle-label" style="font-size:20px;">${monthLabel}</div>
      <div class="cycle-btns">
        <button onclick="budgetGoToMonth(-1)">&#8249;</button>
        <button onclick="budgetGoToMonth(1)">&#8250;</button>
      </div>
    </div>

    <div class="subtle-label" style="margin-bottom:8px;">THIS MONTH'S FINANCIALS</div>
    <div class="panel">${renderBudgetBar(key)}</div>

    ${renderSavingsProgressSection(key)}

    <div class="subtle-label" style="margin:18px 0 8px;">INCIDENTALS</div>
    <div class="panel">
      ${renderBudgetIncidentalControls()}
      ${/* One container, but two jobs inside it: add above the line, read below it. */ ''}
      <div class="divider" style="margin:14px 0 2px;"></div>
      ${renderBudgetLedgerGroup('income', key)}
      ${renderBudgetLedgerGroup('charge', key)}
    </div>
  </div>`;
}
function renderBudgetRecurring() {
  const incomeList = STATE.budget.recurringIncome;
  const incomeTotal = recurringIncomeMonthlyTotal();
  const list = STATE.budget.recurring;
  const total = budgetRecurringTotal();
  return `<div class="screen">
    <div class="section-title">Recurring</div>
    <div style="font-size:12px; color:var(--text-dim); margin:6px 0 14px;">Everything steady, month to month — income sources, savings/investment targets, and the bills and subscriptions that reserve a slice of your budget bar automatically.</div>

    ${/* One section, like INCIDENTALS: the adder on top, the sources under it. It was an ADD form
          panel and a separate RECURRING INCOME list, which split one subject across two headings. */ ''}
    <div class="row" style="margin-bottom:8px;">
      <div class="subtle-label" style="margin-bottom:0;">INCOME SOURCES</div>
      <span class="mono" style="font-size:13px; font-weight:700;">${fmtMoney(incomeTotal)}/mo</span>
    </div>
    <div class="panel">
      ${renderIncomeSourceControls()}
      <div class="entry-list" style="margin-top:12px;">${incomeList.length
        ? incomeList.map(renderRecurringIncomeRow).join('')
        : `<div style="font-size:11px; color:var(--text-faint);">No recurring income sources yet — add a paycheck or other steady source above.</div>`}</div>
    </div>

    ${renderSavingsPlanSection()}


    <div class="row" style="margin:18px 0 8px;">
      <div class="subtle-label" style="margin-bottom:0;">RECURRING CHARGES</div>
      <span class="mono" style="font-size:13px; font-weight:700;">${fmtMoney(total)}/mo</span>
    </div>
    <div class="panel">
      ${renderRecurringChargeControls()}
      <div class="entry-list" style="margin-top:12px;">${list.length
        ? list.map(renderRecurringRow).join('')
        : `<div style="font-size:11px; color:var(--text-faint);">No recurring charges yet — add your rent, bills and subscriptions above.</div>`}</div>
    </div>
  </div>`;
}
