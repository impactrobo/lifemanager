// test_todo_reminders.js — Reminders gain a 'todo' type alongside the original plain 'reminder':
// the type toggle in the add form, saving with an empty checklist, adding/toggling/editing/
// deleting checklist items on the card, and that an old/plain reminder (no `type` field at all)
// still renders and edits exactly as it always did.
const { chromium } = require('playwright');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    return route.abort();
  });

  await page.goto(APP_PATH);
  await page.waitForTimeout(300);

  await page.evaluate(() => { switchTab('schedule'); setScheduleSubtab('calendar'); calSetZoom('day'); });
  await page.waitForTimeout(150);

  // 1. Opening the form defaults to the plain 'reminder' type; the toggle switches to 'todo'
  await page.evaluate(() => toggleReminderForm());
  await page.waitForTimeout(100);
  const defaultType = await page.evaluate(() => REMINDER_FORM_TYPE);
  if (defaultType !== 'reminder') throw new Error(`Expected the form to default to type "reminder", got "${defaultType}"`);
  await page.evaluate(() => setReminderFormType('todo'));
  await page.waitForTimeout(100);
  const notesHidden = await page.evaluate(() => !document.getElementById('remNotes'));
  if (!notesHidden) throw new Error('Expected the Notes field to be hidden once TO-DO LIST is selected');

  // 2. Save a to-do list — starts with an empty items array
  await page.fill('#remTitle', 'Test Shopping List');
  await page.evaluate(() => saveReminder());
  await page.waitForTimeout(100);
  const todo = await page.evaluate(() => STATE.reminders.find(r => r.title === 'Test Shopping List'));
  console.log('saved todo reminder:', todo);
  if (todo.type !== 'todo' || !Array.isArray(todo.items) || todo.items.length !== 0) {
    throw new Error(`Expected a fresh todo reminder with an empty items array, got ${JSON.stringify(todo)}`);
  }

  // 3. Add checklist items via the real card UI
  await page.fill(`#todoNewItem_${todo.id}`, 'Milk');
  await page.evaluate((id) => addReminderTodoItem(id), todo.id);
  await page.waitForTimeout(100);
  await page.fill(`#todoNewItem_${todo.id}`, 'Eggs');
  await page.evaluate((id) => addReminderTodoItem(id), todo.id);
  await page.waitForTimeout(100);
  const afterAdd = await page.evaluate((id) => STATE.reminders.find(r => r.id === id).items.map(i => i.text), todo.id);
  console.log('items after adding Milk, Eggs:', afterAdd);
  if (JSON.stringify(afterAdd) !== JSON.stringify(['Milk', 'Eggs'])) throw new Error(`Expected ["Milk","Eggs"], got ${JSON.stringify(afterAdd)}`);

  // 4. Toggle one done, confirm via the real checkbox
  const milkId = await page.evaluate((id) => STATE.reminders.find(r => r.id === id).items[0].id, todo.id);
  const checkbox = await page.$(`input[onchange="toggleReminderTodoItem('${todo.id}','${milkId}')"]`);
  await checkbox.click();
  await page.waitForTimeout(100);
  const milkDone = await page.evaluate((args) => STATE.reminders.find(r => r.id === args.id).items.find(i => i.id === args.milkId).done, { id: todo.id, milkId });
  if (!milkDone) throw new Error('Expected clicking the checkbox to mark the item done');
  const doneCountShown = await page.evaluate(() => document.body.textContent.includes('1/2'));
  if (!doneCountShown) throw new Error('Expected a "1/2" done-count caption to render');

  // 5. Edit an item's text, delete another
  await page.evaluate((args) => updateReminderTodoItemText(args.id, args.milkId, 'Oat milk'), { id: todo.id, milkId });
  await page.waitForTimeout(100);
  const eggsId = await page.evaluate((id) => STATE.reminders.find(r => r.id === id).items.find(i => i.text === 'Eggs').id, todo.id);
  await page.evaluate((args) => deleteReminderTodoItem(args.id, args.eggsId), { id: todo.id, eggsId });
  await page.waitForTimeout(100);
  const afterEditDelete = await page.evaluate((id) => STATE.reminders.find(r => r.id === id).items, todo.id);
  console.log('items after editing + deleting:', afterEditDelete);
  if (afterEditDelete.length !== 1 || afterEditDelete[0].text !== 'Oat milk') throw new Error(`Expected just [{text:"Oat milk"}] left, got ${JSON.stringify(afterEditDelete)}`);

  // 6. A plain (pre-existing, no `type` field at all) reminder still works exactly as before
  const plainId = await page.evaluate(() => {
    const id = uid();
    STATE.reminders.push({ id, date: CAL_SELECTED_DATE, time: null, title: 'Old Plain Reminder', notes: 'some notes', createdAt: Date.now() }); // no `type` field
    saveState(); render();
    return id;
  });
  await page.waitForTimeout(100);
  const plainRendersNotes = await page.evaluate((id) => {
    // Title lives in an <input value>, not text content — find the card by its title input's value.
    const titleInput = [...document.querySelectorAll('.entry-card input[type="text"]')].find(i => i.value === 'Old Plain Reminder');
    const card = titleInput ? titleInput.closest('.entry-card') : null;
    return card ? !!card.querySelector('textarea') : false;
  }, plainId);
  if (!plainRendersNotes) throw new Error('Expected an old plain reminder (no type field) to still render its Notes textarea, not a checklist');

  // 7. Persistence across reload
  await page.reload();
  await page.waitForTimeout(300);
  const persistedTodo = await page.evaluate((id) => STATE.reminders.find(r => r.id === id), todo.id);
  console.log('todo after reload:', persistedTodo);
  if (!persistedTodo || persistedTodo.items.length !== 1 || persistedTodo.items[0].text !== 'Oat milk') {
    throw new Error('Expected the todo reminder and its edited item to persist across reload');
  }

  // cleanup
  await page.evaluate((ids) => {
    STATE.reminders = STATE.reminders.filter(r => !ids.includes(r.id));
    saveState();
  }, [todo.id, plainId]);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_todo_reminders.js: PASS');
  process.exit(0);
})();
