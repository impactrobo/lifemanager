// app-entries.js -- the Notes record model: one shape for every kind of entry, the Markdown
// the body is written in, and the one-time migration off STATE.notes.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
//
// ================= ENTRIES =================
// Every note, journal page, recipe and hub is ONE record shape in STATE.entries. That is the
// whole idea: a thing you jot down should never have to be filed before it can be written, so
// everything starts as a Quick note and earns a type later (see docs/NOTES_SPEC.md).
//
// What that buys, concretely: search, sort, tagging, linking, checklists and the card list are
// each written once and work on all six types, instead of six parallel implementations that
// drift. `fields` carries whatever a type needs without widening the record for everyone else.
//
// Deliberately NOT a second link system. The app already has a cross-entity link primitive
// (app-links.js: LINKABLE_TYPES, addEntityLink, the picker, jump-to-and-flash) which reaches
// reminders, workouts, meals and habits as well as notes. Entry-to-entry links here are the
// same mechanism seen from one side, plus `[[id]]` tokens written inline in the body. A note-only
// `links: string[]` would give two systems whose chips disagree about what is connected.

// The six types, each with its colour token and the template fields it eventually grows.
// `fields` is declared from Phase 1 even though the Convert flow that fills them is Phase 4 --
// the record shape is what migrations and sync have to agree on, so it lands once and early.
const ENTRY_TYPES = {
  quick:   { label: 'Quick note', short: 'QUICK',   token: '--note-quick',   dot: 'round',  fields: [] },
  journal: { label: 'Journal',    short: 'JOURNAL', token: '--note-journal', dot: 'round',  fields: ['mood', 'notes', 'highlight', 'gratitude'] },
  writing: { label: 'Writing',    short: 'WRITING', token: '--note-writing', dot: 'round',  fields: ['status', 'outline', 'draft'] },
  travel:  { label: 'Travel',     short: 'TRAVEL',  token: '--note-travel',  dot: 'round',  fields: ['trip', 'places', 'todo', 'packing', 'dayLog'] },
  recipe:  { label: 'Recipe',     short: 'RECIPE',  token: '--note-recipe',  dot: 'round',  fields: ['servings', 'time', 'ingredients', 'steps', 'source', 'rating'] },
  // A hub is an entry too -- that's what lets a hub sit inside another hub, be tagged, be
  // searched and be linked like anything else. Its square dot is the one place type is signalled
  // without relying on colour, since a hub behaves differently from everything else in the list.
  hub:     { label: 'Hub',        short: 'HUB',     token: '--note-hub',     dot: 'square', fields: ['intro'] },
};
const ENTRY_TYPE_ORDER = ['quick', 'journal', 'writing', 'travel', 'recipe', 'hub'];

function entryTypeMeta(type) { return ENTRY_TYPES[type] || ENTRY_TYPES.quick; }
// Colour for a type, read off the CSS custom property so each aesthetic can repaint the whole set
// by redefining six tokens -- see the --note-* block in styles.css.
function entryTypeColor(type) { return 'var(' + entryTypeMeta(type).token + ')'; }

// ---- The collection ----
// Tombstoned entries stay in the array so a deletion can travel to another device rather than
// being silently undone by the next sync pulling the entry back. Everything user-facing walks
// liveEntries(); only export, sync and the undo path see the tombstones.
function allEntries() {
  if (!Array.isArray(STATE.entries)) STATE.entries = [];
  return STATE.entries;
}
function liveEntries() { return allEntries().filter(e => !e.deleted); }
function entryById(id) { return allEntries().find(e => e.id === id) || null; }
function liveEntryById(id) { const e = entryById(id); return e && !e.deleted ? e : null; }

// A brand-new entry. Always quick: picking a type up front is the friction this whole feature
// exists to remove.
function blankEntry(type) {
  const now = Date.now();
  return {
    id: uid(),
    type: type || 'quick',
    title: '',
    body: '',
    fields: {},
    tags: [],
    favorite: false,
    links: [],
    photos: [],
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
}

// The one place an entry is marked changed. Every mutator goes through it so "Edited" sort and
// any future per-record merge can trust updatedAt rather than hoping each call site remembered.
function touchEntry(e) { if (e) e.updatedAt = Date.now(); return e; }

// A displayable name. The spec makes title optional on every type, so the body's first non-empty
// line stands in -- which is what makes a Quick note genuinely quick: type and save, and it still
// has something to be called in a list, a link chip and a search result.
function entryTitleOf(e) {
  if (!e) return 'Untitled';
  const t = (e.title || '').trim();
  if (t) return t;
  const line = (e.body || '').split('\n').map(s => stripEntryMarkdown(s).trim()).find(Boolean);
  return line ? line.slice(0, 80) : 'Untitled';
}
// Plain prose for a card preview. Only the leading PROSE is used: it stops at the first heading,
// bullet, numbered item or checklist line, because flattening those into the paragraph produces a
// run-on ("Buy new strings. Shopping D'Addario Ernie Ball Peg winder") that reads like damaged
// text rather than a preview. A note that opens with a list gets no snippet, and the checklist
// count in the card's meta row is the more useful summary anyway.
function entrySnippet(e, max) {
  const limit = max || 140;
  const lines = String((e && e.body) || '').split('\n');
  // When the title is standing in as the first body line, don't repeat it back underneath.
  const start = (e && (e.title || '').trim()) ? 0 : lines.findIndex(l => l.trim() !== '') + 1;
  const prose = [];
  for (let i = Math.max(0, start); i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { if (prose.length) break; continue; }
    if (/^#{1,6}\s/.test(line) || ENTRY_BULLET_RE.test(line) || ENTRY_NUMBER_RE.test(line)) break;
    prose.push(line);
  }
  const s = stripEntryMarkdown(prose.join(' ')).replace(/\s+/g, ' ').trim();
  return s.length > limit ? s.slice(0, limit) + '…' : s;
}

// ---- Tags ----
// Freeform and plain: lowercase, no '#', no duplicates. The previous Notes had a fixed palette of
// twelve colours and a Setup screen to rename and recolour them; per docs/NOTES_SPEC.md colour is
// now carried by the TYPE instead, which frees tags to be typed on the spot without first being
// created, and frees the colour language from a twelve-item cap.
function normaliseTag(raw) {
  return String(raw == null ? '' : raw).trim().replace(/^#+/, '').trim().toLowerCase().slice(0, 40);
}
function entryTags(e) { return Array.isArray(e && e.tags) ? e.tags : []; }
function addEntryTag(e, raw) {
  const tag = normaliseTag(raw);
  if (!e || !tag) return false;
  if (!Array.isArray(e.tags)) e.tags = [];
  if (e.tags.includes(tag)) return false;   // "Same tag twice" is a no-op, not an error
  e.tags.push(tag);
  touchEntry(e);
  return true;
}
function removeEntryTag(e, tag) {
  if (!e || !Array.isArray(e.tags)) return;
  e.tags = e.tags.filter(t => t !== tag);
  touchEntry(e);
}
// Every tag in use, with how often and how recently -- the ranking the suggestion row wants
// (count first, then recency), computed rather than stored so it can never disagree with the
// entries themselves.
function entryTagIndex() {
  const idx = new Map();
  liveEntries().forEach(e => {
    entryTags(e).forEach(tag => {
      const row = idx.get(tag) || { tag, count: 0, lastUsed: 0 };
      row.count += 1;
      row.lastUsed = Math.max(row.lastUsed, e.updatedAt || e.createdAt || 0);
      idx.set(tag, row);
    });
  });
  return Array.from(idx.values()).sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed);
}
// Suggestions for the tag input: ranked tags this entry doesn't already carry, optionally
// narrowed by what's been typed so far.
function entryTagSuggestions(e, query, limit) {
  const has = new Set(entryTags(e));
  const q = normaliseTag(query);
  return entryTagIndex()
    .filter(r => !has.has(r.tag) && (!q || r.tag.includes(q)))
    .slice(0, limit || 8);
}

// ---- Links ----
// Outgoing links are the explicit `links` array plus every [[id]] token written into the body or
// a template field -- deduplicated, self-links dropped. Computed on read rather than stored,
// because a stored copy is one more thing that can disagree with the text you can see.
const ENTRY_TOKEN_RE = /\[\[([^\[\]]+)\]\]/g;
function entryTokenIds(text) {
  const out = [];
  String(text || '').replace(ENTRY_TOKEN_RE, (m, id) => { out.push(id.trim()); return m; });
  return out;
}
// NOTE ON THE SHAPE. docs/NOTES_SPEC.md models `links` as a bare array of entry ids. It is stored
// here in app-links.js's existing cross-entity shape instead -- [{type, id}], where an
// entry-to-entry link is simply {type:'note', id} -- because that array already exists on these
// records and already reaches reminders, workouts, meals and habits. Two arrays called `links`
// with different shapes on the same object is how you get chips that disagree about what is
// connected; one array, read two ways, cannot.
function entryLinkRows(e) { return Array.isArray(e && e.links) ? e.links : []; }
function entryOutgoingLinks(e) {
  if (!e) return [];
  const seen = new Set([e.id]);
  const out = [];
  const push = id => { if (id && !seen.has(id)) { seen.add(id); out.push(id); } };
  entryLinkRows(e).forEach(l => { if (l && l.type === 'note') push(l.id); });
  entryTokenIds(e.body).forEach(push);
  Object.keys(e.fields || {}).forEach(k => entryTokenIds(e.fields[k]).forEach(push));
  return out;
}
function entryBacklinks(e) {
  if (!e) return [];
  return liveEntries().filter(o => o.id !== e.id && entryOutgoingLinks(o).includes(e.id));
}
function linkEntries(fromId, toId) {
  const from = entryById(fromId);
  if (!from || fromId === toId || !entryById(toId)) return false;   // no self-links, no phantoms
  if (!Array.isArray(from.links)) from.links = [];
  if (entryOutgoingLinks(from).includes(toId)) return false;        // already connected, in text or out
  from.links.push({ type: 'note', id: toId });
  touchEntry(from);
  return true;
}
function unlinkEntries(fromId, toId) {
  const from = entryById(fromId);
  if (!from || !Array.isArray(from.links)) return;
  from.links = from.links.filter(l => !(l && l.type === 'note' && l.id === toId));
  touchEntry(from);
}

// ---- Markdown ----
// A small, fixed set, stored as plain text and rendered when viewing. Plain text is the point:
// it survives export, diffing and sync as exactly what was typed, and a body can be edited
// anywhere without a rich-text editor's cursor and paste problems. (The previous Notes stored
// sanitized contenteditable HTML, which is why migration below has an HTML-to-Markdown pass.)
//
// SAFETY: escapeHtml runs FIRST on the raw text, and every rule below only ever inserts markup of
// its own. Nothing a person types can therefore become an element, an attribute or a URL scheme
// -- which is what lets a body render without a sanitizer pass on the way out.

// Formatting removed, text kept -- for snippets, search and the title fallback.
function stripEntryMarkdown(text) {
  return String(text || '')
    .replace(ENTRY_TOKEN_RE, (m, id) => { const t = liveEntryById(id.trim()); return t ? entryTitleOf(t) : ''; })
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

const ENTRY_CHECK_RE = /^(\s*)[-*]\s+\[([ xX])\]\s?(.*)$/;
const ENTRY_BULLET_RE = /^\s*[-*]\s+(.*)$/;
const ENTRY_NUMBER_RE = /^\s*(\d+)[.)]\s+(.*)$/;

// Checklist progress for a card ("3/5"). Counts every checklist line in the body AND in template
// fields, since a Travel packing list or a Recipe ingredient list is a checklist too.
function entryChecklistStats(e) {
  let total = 0, done = 0;
  const scan = text => String(text || '').split('\n').forEach(line => {
    const m = line.match(ENTRY_CHECK_RE);
    if (!m) return;
    total += 1;
    if (m[2] !== ' ') done += 1;
  });
  scan(e && e.body);
  Object.keys((e && e.fields) || {}).forEach(k => scan(e.fields[k]));
  return { total, done };
}
// Flip the nth checklist line of a text block. Indexed by checklist position rather than by line
// number so the caller doesn't have to know how many prose lines sit between items.
function toggleChecklistAt(text, nth) {
  let seen = -1;
  return String(text || '').split('\n').map(line => {
    const m = line.match(ENTRY_CHECK_RE);
    if (!m) return line;
    seen += 1;
    if (seen !== nth) return line;
    return `${m[1]}- [${m[2] === ' ' ? 'x' : ' '}] ${m[3]}`;
  }).join('\n');
}

// Inline rules, applied after escaping. Order matters: bold before italic (so ** isn't eaten as
// two single asterisks), and links before both so formatting can't split a URL in half.
function renderEntryInline(escaped) {
  return escaped
    // [[id]] -> the target's CURRENT title. Storing ids rather than titles is what makes renaming
    // safe; the two failure states are shown rather than hidden, because a link that silently
    // renders as nothing is worse than one that says what went wrong.
    .replace(/\[\[([^\[\]]+)\]\]/g, (m, rawId) => {
      const id = rawId.trim();
      const target = entryById(id);
      if (!target) return `<span class="entry-link entry-link-missing">Missing note</span>`;
      if (target.deleted) return `<span class="entry-link entry-link-dead">Deleted note</span>`;
      return `<a class="entry-link" style="color:${entryTypeColor(target.type)}" href="#" onclick="openEntry('${escapeHtml(id)}'); return false;">${escapeHtml(entryTitleOf(target))}</a>`;
    })
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) =>
      `${pre}<a class="entry-url" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// Block-level render. `checkHandler` is the JS called when a checkbox is tapped, given the
// checklist index -- View mode passes one, a read-only preview passes nothing and the boxes
// render inert.
function renderEntryMarkdown(text, checkHandler) {
  const lines = String(text || '').split('\n');
  const out = [];
  let list = null;              // 'ul' | 'ol' | null -- the list currently being accumulated
  let checkIdx = -1;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const openList = kind => { if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; } };

  lines.forEach(raw => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeList(); return; }

    const heading = line.match(/^(#{1,2})\s+(.*)$/);
    if (heading) {
      closeList();
      const tag = heading[1].length === 1 ? 'h3' : 'h4';   // h1/h2 belong to the app's own chrome
      out.push(`<${tag} class="entry-h">${renderEntryInline(escapeHtml(heading[2]))}</${tag}>`);
      return;
    }

    const check = line.match(ENTRY_CHECK_RE);
    if (check) {
      openList('ul');
      checkIdx += 1;
      const done = check[2] !== ' ';
      const onclick = checkHandler ? ` onclick="${checkHandler}(${checkIdx})"` : '';
      out.push(`<li class="entry-check ${done ? 'is-done' : ''}">` +
        `<button type="button" class="entry-check-box" ${checkHandler ? '' : 'disabled'}${onclick} aria-pressed="${done}">${done ? '✓' : ''}</button>` +
        `<span class="entry-check-text">${renderEntryInline(escapeHtml(check[3]))}</span></li>`);
      return;
    }

    const bullet = line.match(ENTRY_BULLET_RE);
    if (bullet) { openList('ul'); out.push(`<li>${renderEntryInline(escapeHtml(bullet[1]))}</li>`); return; }

    const numbered = line.match(ENTRY_NUMBER_RE);
    if (numbered) { openList('ol'); out.push(`<li>${renderEntryInline(escapeHtml(numbered[2]))}</li>`); return; }

    closeList();
    out.push(`<p>${renderEntryInline(escapeHtml(line))}</p>`);
  });
  closeList();
  return out.join('');
}

// ---- Typing helpers ----
// Enter on a list line continues the list; Enter on an EMPTY list item ends it instead of
// stacking empty bullets forever. Returns the replacement text and where to put the cursor, or
// null when the line isn't a list item and the browser's own newline is correct.
function continueEntryList(text, caret) {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const lineStart = before.lastIndexOf('\n') + 1;
  const line = before.slice(lineStart);

  const check = line.match(ENTRY_CHECK_RE);
  const bullet = !check && line.match(ENTRY_BULLET_RE);
  const numbered = !check && !bullet && line.match(ENTRY_NUMBER_RE);
  if (!check && !bullet && !numbered) return null;

  const content = check ? check[3] : bullet ? bullet[1] : numbered[2];
  if (!content.trim()) {
    // An empty item means "I'm done with this list" -- drop the marker and break out.
    const next = before.slice(0, lineStart) + '\n' + after;
    return { text: next, caret: lineStart + 1 };
  }
  const marker = check ? `${check[1]}- [ ] ` : bullet ? '- ' : `${Number(numbered[1]) + 1}. `;
  const insert = '\n' + marker;
  return { text: before + insert + after, caret: caret + insert.length };
}

// Toggle a marker on whichever line the cursor sits in -- the Bullet/Numbered/Checklist toolbar
// buttons. Applying the marker a second time removes it, so one button both adds and clears.
function toggleEntryLinePrefix(text, caret, kind) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  let lineEnd = text.indexOf('\n', caret);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const bare = line.replace(ENTRY_CHECK_RE, '$1$3').replace(/^(\s*)[-*]\s+/, '$1').replace(/^(\s*)\d+[.)]\s+/, '$1');
  const already =
    kind === 'check' ? ENTRY_CHECK_RE.test(line) :
    kind === 'bullet' ? (!ENTRY_CHECK_RE.test(line) && ENTRY_BULLET_RE.test(line)) :
    ENTRY_NUMBER_RE.test(line);
  const marker = already ? '' : kind === 'check' ? '- [ ] ' : kind === 'bullet' ? '- ' : '1. ';
  const next = marker + bare;
  return {
    text: text.slice(0, lineStart) + next + text.slice(lineEnd),
    caret: Math.max(lineStart, caret + (next.length - line.length)),
  };
}
// Wrap or unwrap the selection -- Bold and Italic. With nothing selected it drops the markers in
// and puts the cursor between them, so the button works as "start typing bold" too.
function wrapEntrySelection(text, start, end, marker) {
  const sel = text.slice(start, end);
  const outerStart = start - marker.length, outerEnd = end + marker.length;
  if (sel && text.slice(outerStart, start) === marker && text.slice(end, outerEnd) === marker) {
    return { text: text.slice(0, outerStart) + sel + text.slice(outerEnd), caret: outerStart + sel.length };
  }
  const next = text.slice(0, start) + marker + sel + marker + text.slice(end);
  return { text: next, caret: sel ? start + marker.length + sel.length + marker.length : start + marker.length };
}
// Heading cycles none -> # -> ## -> none, so one button reaches both levels.
function cycleEntryHeading(text, caret) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  let lineEnd = text.indexOf('\n', caret);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const m = line.match(/^(#{1,2})\s+(.*)$/);
  const bare = m ? m[2] : line;
  const next = (!m ? '# ' : m[1] === '#' ? '## ' : '') + bare;
  return {
    text: text.slice(0, lineStart) + next + text.slice(lineEnd),
    caret: Math.max(lineStart, caret + (next.length - line.length)),
  };
}

// ---- Migration off STATE.notes ----
// Runs once. STATE.notes is left EXACTLY as it was: the spec asks for the old data to survive
// until the move is confirmed, and a migration that deletes its own source has no way back if it
// turns out to have mangled something. loadState()'s merge keeps the old array alive
// indefinitely at the cost of a few KB, which is the right trade for the only copy of things
// somebody wrote down.
//
// The old body was sanitized contenteditable HTML (an allowlist of B/STRONG/I/EM/U/UL/OL/LI/
// BR/DIV/P/SPAN). Everything in it has a Markdown equivalent except underline, which the spec's
// format set has no syntax for -- those become plain text rather than inventing a syntax that
// nothing else in the app can read.
// The five tags that were built into the old Notes before they became editable rows. Still needed
// because migrateState() seeds them into settings.customNoteTags on any save that predates that
// change, and the entry migration below reads those labels to name its tags.
const LEGACY_BUILTIN_NOTE_TAGS = [
  { key: 'idea',    label: 'Idea',       dark: '#FFD961', light: '#8a6d00' },
  { key: 'todo',    label: 'To-Do',      dark: '#819FFF', light: '#2a4fc9' },
  { key: 'win',     label: 'Experience', dark: '#B2FF5D', light: '#4d7a00' },
  { key: 'issue',   label: 'Issue',      dark: '#FF9191', light: '#b23a3a' },
  { key: 'reflect', label: 'Reflection', dark: '#CAAFFF', light: '#6b3fa0' },
];
// What a legacy tag key was actually CALLED, including any rename. Reads settings directly rather
// than going through the old Notes helpers, all of which are gone — this is the last thing that
// needs to understand the previous tag model, and it only runs once.
function legacyNoteTagLabel(key) {
  const settings = STATE.settings || {};
  const custom = (settings.customNoteTags || []).find(t => t.key === key);
  if (custom && custom.label) return custom.label;
  const builtin = LEGACY_BUILTIN_NOTE_TAGS.find(t => t.key === key);
  if (builtin) return builtin.label;
  const named = settings.noteTagNames && settings.noteTagNames[key];
  return (named && named.trim()) || key;
}

function htmlToMarkdown(html) {
  const root = document.createElement('div');
  root.innerHTML = html || '';
  const walk = (node, ctx) => {
    let out = '';
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === 3) { out += (child.nodeValue || '').replace(/\s+/g, ' '); return; }
      if (child.nodeType !== 1) return;
      const el = /** @type {HTMLElement} */ (child);
      const tag = el.tagName;
      if (tag === 'BR') { out += '\n'; return; }
      if (tag === 'B' || tag === 'STRONG') { const t = walk(el, ctx).trim(); out += t ? `**${t}**` : ''; return; }
      if (tag === 'I' || tag === 'EM') { const t = walk(el, ctx).trim(); out += t ? `*${t}*` : ''; return; }
      if (tag === 'UL' || tag === 'OL') {
        const ordered = tag === 'OL';
        let n = 0;
        Array.from(el.children).forEach(li => {
          if (li.tagName !== 'LI') return;
          n += 1;
          const t = walk(li, ctx).trim();
          if (t) out += `\n${ordered ? n + '. ' : '- '}${t}`;
        });
        out += '\n';
        return;
      }
      if (tag === 'DIV' || tag === 'P') { const t = walk(el, ctx).trim(); out += (t ? '\n' + t : '') + '\n'; return; }
      out += walk(el, ctx);   // U and SPAN contribute their text and nothing else
    });
    return out;
  };
  return walk(root, {})
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map(l => l.replace(/\s+$/, '')).join('\n')
    .trim();
}

// A single old note becomes a single entry. Recipes keep their type and their structured
// ingredients rather than being flattened to Quick notes: those ingredients are real {foodId,
// qty, unit} rows that already drive "add to Meals", and throwing them away to satisfy "every
// note migrates as a Quick note" would break a feature that works today.
function entryFromLegacyNote(n) {
  const isRecipe = n.type === 'recipe';
  const createdAt = Number(n.createdAt) || (n.date ? new Date(n.date + 'T12:00:00').getTime() : Date.now());
  const body = n.bodyHtml !== undefined ? htmlToMarkdown(n.bodyHtml) : String(n.text || '').trim();
  const e = {
    id: n.id || uid(),
    type: isRecipe ? 'recipe' : 'quick',
    title: (n.title || '').trim(),
    body: body,
    fields: {},
    // The old model allowed exactly one tag, always set, defaulting to 'general'. General meant
    // "not filed" rather than a real label, so it becomes NO tag -- carrying it across would tag
    // most of the library with a word that never told you anything.
    tags: [],
    favorite: false,
    // Cross-entity links carry across untouched — a note already linked to a meal stays linked.
    links: Array.isArray(n.links) ? n.links.map(l => Object.assign({}, l)) : [],
    photos: Array.isArray(n.photos) ? n.photos.slice() : [],
    createdAt: createdAt,
    updatedAt: Number(n.updatedAt) || createdAt,
    deleted: false,
  };
  if (n.tag && n.tag !== 'general') {
    const tag = normaliseTag(legacyNoteTagLabel(n.tag));
    if (tag) e.tags.push(tag);
  }
  if (isRecipe) {
    e.fields.ingredients = Array.isArray(n.ingredients) ? n.ingredients.map(i => Object.assign({}, i)) : [];
    if (n.servings != null) e.fields.servings = String(n.servings);
    const time = [];
    if (n.prepMinutes) time.push(n.prepMinutes + ' min prep');
    if (n.cookMinutes) time.push(n.cookMinutes + ' min cook');
    if (time.length) e.fields.time = time.join(' + ');
    e.fields.steps = body;   // the old "Method" body is what a recipe's steps always were
  }
  return e;
}

// Guarded by its own flag so it runs once per save. A brand-new install has nothing to move but
// still flips the flag, so a note written today is never re-migrated tomorrow.
function migrateNotesToEntries() {
  if (!Array.isArray(STATE.entries)) STATE.entries = [];
  if (STATE.settings && STATE.settings.entriesMigrated) return;
  const legacy = Array.isArray(STATE.notes) ? STATE.notes : [];
  const have = new Set(STATE.entries.map(e => e.id));
  legacy.forEach(n => {
    if (!n || have.has(n.id)) return;   // ids carry across, so re-running can never duplicate
    STATE.entries.push(entryFromLegacyNote(n));
  });
  if (STATE.settings) STATE.settings.entriesMigrated = true;
}
