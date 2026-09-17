// app-entry-convert.js -- turning a Quick note into a typed one, and back.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
//
// ================= CONVERT (NOTES_SPEC Phase 4) =================
// Everything starts as a Quick note, so that writing something down never requires deciding what
// it is first. Convert is the other half of that bargain: the moment you DO know, the note sorts
// itself into the right shape.
//
// THE RULES ARE FIXED AND LOCAL. No AI, nothing leaves the device, and the same input always
// produces the same split — which is what makes the review screen worth reading rather than
// re-checking from scratch every time. They are also, deliberately, only a first guess: every
// piece lands under a field with a MOVE button, and anything no rule claimed sits in UNSORTED
// where it is impossible to miss. The one hard guarantee is that **no text is ever dropped** —
// test_entry_convert.js asserts it by reassembling every line back out of the plan.

// Each rule is `{ id, test, to }`, where `to` maps a destination TYPE to the field it lands in.
// A rule with no entry for the type being converted to simply doesn't apply, so the next rule
// gets a look — otherwise converting to Journal would be a list of rules that match and do
// nothing. Order is the spec's order, and the first applicable rule wins.
//
// 'entries' is not a text field: it means "make this a member of the hub", which is why
// applyEntryConvert() handles it separately.
const CONVERT_RULES = [
  { id: 'linkedHub',    test: (l) => convertLinkKind(l) === 'hub',    to: { travel: 'trip',   hub: 'entries' } },
  { id: 'linkedTravel', test: (l) => convertLinkKind(l) === 'travel', to: { travel: 'places', hub: 'entries' } },
  { id: 'linkedAny',    test: (l) => convertLinkKind(l) === 'any',    to: { hub: 'entries' } },
  { id: 'numbered',     test: (l) => /^\s*\d+[.)]\s+\S/.test(l),      to: { recipe: 'steps', writing: 'outline' } },
  // "2 cups", "200g", "1 tbsp", "1/2 tsp" — a quantity at the start of the line with a unit after
  // it. Anchored to the start so "I walked 3 km" doesn't read as an ingredient.
  { id: 'amountUnit',   test: (l) => /^\s*(?:[-*]\s*)?\d+(?:[.,/]\d+)?\s*(?:g|kg|mg|ml|l|oz|lb|lbs|cups?|tbsps?|tsps?|tablespoons?|teaspoons?|cloves?|slices?|pinch(?:es)?|cans?|sticks?)\b/i.test(l),
                                                                      to: { recipe: 'ingredientText' } },
  { id: 'bullet',       test: (l) => /^\s*[-*]\s+\S/.test(l),         to: { travel: 'packing', recipe: 'ingredientText' } },
  { id: 'packing',      test: (l) => /\b(pack|packing|bring|carry)\b/i.test(l),           to: { travel: 'packing' } },
  { id: 'todo',         test: (l) => /\b(ask|book|buy|call|reserve)\b/i.test(l),          to: { travel: 'todo' } },
  // The spec folds these into one rule ("serves, servings, minutes, hours -> servings / time").
  // Split, because they are two different fields and a rule that can't say which is not a rule.
  // Stores the whole line, "Serves 4 generously" and all. `fields.servings` is read as a NUMBER by
  // recipeServings(), which divides a batch into portions — so the READER extracts the count from
  // whatever is written rather than this rule trimming the sentence down to a digit. Narrowing
  // here would drop "generously", and "no text is ever dropped" is the one promise Convert makes.
  { id: 'servings',     test: (l) => /\b(serves|servings?)\b/i.test(l),                   to: { recipe: 'servings' } },
  { id: 'time',         test: (l) => /\b(minutes?|mins?|hours?|hrs?)\b/i.test(l),         to: { recipe: 'time' } },
  { id: 'mood',         test: (l) => /\b(felt|feel|feeling|mood)\b/i.test(l),             to: { journal: 'mood' } },
  { id: 'gratitude',    test: (l) => /\b(grateful|thankful|gratitude)\b/i.test(l),        to: { journal: 'gratitude' } },
  { id: 'url',          test: (l) => /https?:\/\/\S+/i.test(l),                           to: { recipe: 'source' } },
];
// What a line with no rule match does, per type. Travel and Recipe have no catch-all field, so
// their leftovers go to UNSORTED and stay visible on the entry rather than being guessed at.
const CONVERT_FALLBACK = { journal: 'notes', writing: 'draft', hub: 'body', quick: 'body' };

// Which kind of entry a line links to, for rules 1-3. Reads only the FIRST token in the line,
// since a line that links two things is about the first one.
function convertLinkKind(line) {
  const ids = entryTokenIds(line);
  if (!ids.length) return null;
  const target = liveEntryById(ids[0]);
  if (!target) return 'any';                 // a link we can't resolve is still a link
  if (target.type === 'hub') return 'hub';
  if (target.type === 'travel') return 'travel';
  return 'any';
}

// The lines Convert works on. Blank lines are dropped (they carry no content and would show up in
// the review as empty rows); everything else is kept verbatim, markers and all, so that moving a
// bullet into Packing keeps it a bullet.
function convertLinesOf(e) {
  const parts = [];
  const push = t => String(t || '').split('\n').forEach(l => { if (l.trim()) parts.push(l.replace(/\s+$/, '')); });
  push(e && e.body);
  // Converting a TYPED entry to another type has to reconsider what's already in its fields, or
  // journal -> travel would silently keep four journal fields nobody can see any more.
  entryTypeMeta(e && e.type).fields.forEach(f => push(entryFieldValue(e, f)));
  push(entryFieldValue(e, 'unsorted'));
  return parts;
}

// The first guess: every line placed under a field, plus whatever nothing claimed. Pure — it
// reads the entry and returns a plan, changing nothing, so the review screen can be re-rendered
// and edited freely before anything is committed.
function planEntryConvert(e, toType) {
  const lines = convertLinesOf(e);
  const buckets = {};                  // field key -> [lines]
  const unsorted = [];
  const put = (field, line) => { (buckets[field] || (buckets[field] = [])).push(line); };
  lines.forEach(line => {
    const rule = CONVERT_RULES.find(r => r.to[toType] && r.test(line));
    if (rule) { put(rule.to[toType], line); return; }
    const fallback = CONVERT_FALLBACK[toType];
    if (fallback) put(fallback, line); else unsorted.push(line);
  });
  return { toType, buckets, unsorted };
}
// Every field a plan could put something in, for the review screen's MOVE / PLACE pickers. 'body'
// and 'entries' are included where they mean something, because "put this in the intro" and "make
// this a hub member" are both real destinations a person might want.
function convertTargets(toType) {
  const out = entryTypeMeta(toType).fields.slice();
  if (toType === 'hub') { out.unshift('body'); out.push('entries'); }
  if (toType === 'journal' || toType === 'writing' || toType === 'quick') out.unshift('body');
  out.push('unsorted');
  return out;
}
function convertTargetLabel(key) {
  if (key === 'body') return 'Body / intro';
  if (key === 'entries') return 'Hub members';
  return entryFieldMeta(key).label;
}
// Move one line between buckets in a plan. Index-based rather than value-based: two identical
// lines are two separate pieces of text and moving one must not move the other.
function moveConvertLine(plan, fromField, index, toField) {
  const src = fromField === 'unsorted' ? plan.unsorted : (plan.buckets[fromField] || []);
  if (index < 0 || index >= src.length) return plan;
  const [line] = src.splice(index, 1);
  if (toField === 'unsorted') plan.unsorted.push(line);
  else (plan.buckets[toField] || (plan.buckets[toField] = [])).push(line);
  return plan;
}

// ---- Applying ----
// A deep clone of everything Convert can touch, taken BEFORE the write. Undo restores it wholesale
// rather than trying to reverse each step: the spec asks for "restores the entry exactly as it
// was", and a reversal that is merely nearly right is worse than no undo at all.
function entryConvertSnapshot(e) {
  return {
    id: e.id,
    type: e.type,
    body: e.body,
    fields: JSON.parse(JSON.stringify(e.fields || {})),
    hubItems: Array.isArray(e.hubItems) ? JSON.parse(JSON.stringify(e.hubItems)) : undefined,
    updatedAt: e.updatedAt,
  };
}
function restoreEntryConvert(snap) {
  const e = entryById(snap.id);
  if (!e) return false;
  e.type = snap.type;
  e.body = snap.body;
  e.fields = JSON.parse(JSON.stringify(snap.fields));
  if (snap.hubItems) e.hubItems = JSON.parse(JSON.stringify(snap.hubItems)); else delete e.hubItems;
  touchEntry(e);
  e.updatedAt = snap.updatedAt;          // an undo is not an edit
  invalidateEntryIndex();
  return true;
}

// Commits a plan. Returns the snapshot so the caller can offer Undo.
//
// Tags and links are never touched — the spec is explicit, and they are the two things that mean
// the same regardless of what shape the note is in.
function applyEntryConvert(e, plan) {
  const snap = entryConvertSnapshot(e);
  const toType = plan.toType;

  // Converting back to Quick flattens everything into the body in field order, so that nothing
  // has to be dug out of a shape that no longer exists.
  if (toType === 'quick') {
    e.body = flattenEntryFields(e, plan);
    e.fields = {};
    delete e.hubItems;
    e.type = 'quick';
    touchEntry(e);
    invalidateEntryIndex();
    return snap;
  }

  const join = arr => (arr || []).join('\n');
  const nextFields = {};
  // Structured recipe ingredients are DATA, not prose — they survive a convert untouched, because
  // rebuilding {foodId, qty, unit} rows out of text is exactly the guesswork this feature avoids.
  if (Array.isArray(e.fields && e.fields.ingredients)) nextFields.ingredients = e.fields.ingredients;

  entryTypeMeta(toType).fields.forEach(f => {
    const text = join(plan.buckets[f]);
    if (text) nextFields[f] = text;
  });
  if (plan.unsorted.length) nextFields.unsorted = join(plan.unsorted);

  e.type = toType;
  e.body = join(plan.buckets.body);
  e.fields = nextFields;

  if (toType === 'hub') {
    if (!Array.isArray(e.hubItems)) e.hubItems = [];
    // "Hub: entries" means the linked entry becomes a member. The line's own text is kept as that
    // member's line of context, minus the link itself, so why-it's-here isn't thrown away.
    (plan.buckets.entries || []).forEach(line => {
      const ids = entryTokenIds(line);
      if (!ids.length) return;
      const id = ids[0];
      if (id === e.id || !liveEntryById(id) || hubHasMember(e, id)) return;
      const note = stripEntryMarkdown(line.replace(ENTRY_TOKEN_RE, ' ')).replace(/\s+/g, ' ').trim();
      e.hubItems.push(note ? { id, note } : { id });
    });
  } else {
    delete e.hubItems;
  }
  touchEntry(e);
  invalidateEntryIndex();
  return snap;
}
// Field order, then the leftovers — the order the fields are declared in is the order they read
// in, so flattening reproduces something that looks like the note you'd have written.
function flattenEntryFields(e, plan) {
  const parts = [];
  const push = t => { const s = String(t || '').trim(); if (s) parts.push(s); };
  if (plan) {
    push((plan.buckets.body || []).join('\n'));
    convertTargets(plan.toType).forEach(f => {
      if (f === 'body' || f === 'entries') return;
      push((plan.buckets[f] || []).join('\n'));
    });
    push(plan.unsorted.join('\n'));
    return parts.join('\n\n');
  }
  push(e.body);
  entryTypeMeta(e.type).fields.forEach(f => push(entryFieldValue(e, f)));
  push(entryFieldValue(e, 'unsorted'));
  return parts.join('\n\n');
}
