# LIFEMan Notes — Feature Spec

As of 2026-09-17. Source of truth: the shared Claude Doc "LIFEMan Notes — Feature Spec". Re-export this file if the doc changes.

**Build status: Phase 1 (Capture) shipped 2026-09-17.** Where the code and this document disagree,
the code wins and the divergence is recorded in `docs/ROADMAP.md`. Four deliberate departures so
far: tags kept no colour but the six entry TYPES carry it; `links` is stored in app-links.js's
cross-entity `[{type, id}]` shape rather than a bare id array, so one link system serves the whole
app; recipes keep their structured food-database ingredients (Phase 5 adds free text plus a Match
button on top, rather than replacing them); and entries do NOT sync as individual records — Cloud
Sync writes the whole state as one blob, last-write-wins, so the newer device wins, not the newer
entry.

## Overview

Notes gives LIFEMan one linked system for quick notes, journaling, writing, travel and recipes. Every entry can link to any other, and manual hubs gather related entries in your own order. It replaces the current Notes section.

**Principles**

- Every new entry starts as a Quick Note and can be converted to a type later.
- Links store entry IDs, so renaming never breaks a link. Backlinks appear automatically.
- Hubs are manual only: you pick the entries, the order and a line of context for each.
- Tags are freeform. Existing tags are suggested as the library grows.
- Each entry type has a color, taken from the active LIFEMan theme.
- Converting a note sorts its text with fixed on-device rules. No AI.
- Offline-first, syncing through LIFEMan's existing opt-in Firebase sync.
- Keeps LIFEMan's current look.

## Data model

All notes, of every type, are one record shape in a single `entries` collection. Hubs are entries too.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique and permanent. Links point here. |
| `type` | enum | `quick`, `journal`, `writing`, `travel`, `recipe`, `hub` |
| `title` | string | Optional. The UI falls back to the body's first line. |
| `body` | string | Light Markdown (see Text formatting). Inline links are stored as `[[id]]` tokens and shown as the target's current title. |
| `fields` | object | Template values keyed by field name, plus `unsorted` for text Convert could not place. |
| `tags` | string[] | Lowercase, no `#`, no duplicates. |
| `favorite` | boolean | Starred by the user. Syncs like any other change. |
| `links` | string[] | Entry IDs added with the Link button. No duplicates, no self-links. |
| `hubItems` | {id, note}[] | Hubs only. Array order is display order. `note` is the optional line of context. |
| `createdAt` | number | Milliseconds. Shown as the entry date. |
| `updatedAt` | number | Bumped on every change. Drives "Edited" sort and sync merges. |
| `deleted` | boolean | Tombstone, so deletions sync. |

**Computed at load, updated on save (never stored)**

- **Outgoing links:** `links` plus every `[[id]]` token in `body` and `fields`, deduplicated.
- **Backlinks:** for each entry, every entry whose outgoing links include it.
- **In hubs:** for each entry, every hub whose `hubItems` include it. Shown with backlinks.
- **Tag index:** tag, use count and last-used time. Feeds suggestions.
- **Title index:** for `[[` autocomplete and the link picker.

## Entry types and templates

Six types, each with a theme color and a fixed set of template fields. The date comes from `createdAt` on every type.

| Type | Color token | Default color | Template fields |
| --- | --- | --- | --- |
| Quick note | `--note-quick` | #94a3b8 | Body only |
| Journal | `--note-journal` | #a78bfa | mood, notes, highlight, gratitude |
| Writing | `--note-writing` | #60a5fa | status (idea / draft / done), outline, draft |
| Travel | `--note-travel` | #34d399 | trip, places, todo, packing, dayLog |
| Recipe | `--note-recipe` | #fb923c | servings, time, ingredients, steps, source, rating |
| Hub | `--note-hub` | #facc15 | intro, plus ordered `hubItems` |

- Each LIFEMan theme defines the six tokens. The defaults above come from the mockups.
- Hubs use a square dot; all other types use a round dot, so type is not shown by color alone.
- Empty fields show as "+ Add …" placeholders, never as blank space.

## Text formatting and checklists

The body and every text field use a small set of Markdown, stored as plain text and rendered when viewing.

| Syntax | Result |
| --- | --- |
| `# ` / `## ` at line start | Heading / subheading |
| `**text**` | Bold |
| `*text*` | Italic |
| `- ` at line start | Bullet |
| `1. ` at line start | Numbered item |
| `- [ ] ` / `- [x] ` at line start | Open / checked checklist item |
| `[[id]]` | Link to an entry |
| `https://…` | Clickable web link |

Tables, images, code blocks and embedded notes are not supported yet.

**Editing**

- Entries open in Edit mode as raw text with light styling; saving switches to View mode, which renders the formatting.
- Tapping the body in View mode returns to Edit mode.
- An **Aa** toolbar button opens a format row: Heading, Bold, Italic, Bullet, Numbered.
- Enter on a bullet, numbered or checklist line continues the list. Enter on an empty item ends it.

**Checklists**

- The Checklist button turns the current line into `- [ ] `, or back to plain text if it already is one.
- In View mode, tapping a checkbox toggles it and saves immediately (`updatedAt` changes).
- Checked items show struck through and stay in place.
- View all cards show progress, such as "3/5", when an entry has checklist items.
- Checklists work in every type and in template fields, such as Travel packing or Recipe ingredients. Convert keeps each item's checked state.
- No due dates or reminders; real tasks belong in TASKMan.

## Screens and behaviors

**View all**

- Header with the entry count, and a search box matching title, body, fields and tags. Typing `#tag` filters by that tag.
- Filter chips: Favorites, All, Quick, Journal, Writing, Travel, Recipe, Hubs. Favorites is a filter only; it never changes the sort order of other views.
- Sort: Newest, Oldest, A–Z, Edited. The choice is remembered.
- Each card shows a favorite star, the type dot and label, date, title, snippet, tags, and outgoing and backlink counts.
- Tapping a card expands it to show outgoing links (solid chips) and backlinks (dashed chips). Tapping a chip jumps to that entry and clears filters.
- A floating "Quick note" button opens a new entry.

**Entry editor**

- Type chip at the top opens Convert. A star button marks the entry as a favorite. Date on the right.
- Optional title, then the body.
- Typing `[[` opens autocomplete (details in Phase 2 scope), plus "Create as new note".
- Toolbar: Link (opens the picker), `[[ ]]` (inserts brackets), Aa (format row), Tag, Add to hub, Checklist.
- Links section: chips for outgoing links.
- Tags section: tag chips, an input, and suggested tags with use counts. Suggestions appear once any tags exist, ranked by count then recency.
- Linked from section: backlinks and hubs, or an empty-state line.
- Save returns to View all. Unsaved text is kept as a local draft.

**Link picker (sheet)**

- Search, then tabs: Recent, Hubs, A–Z.
- Each row has a type dot, title, type and date, and a Link / Linked toggle.
- Done closes the sheet. The current entry is never listed.

**Hub view**

- Intro text, then the ordered entries, each with its optional context line.
- Reorder by drag, or with move up / move down buttons.
- Add entries with the link picker. Remove an entry without deleting it.
- Hubs can contain other hubs.

**Convert flow**

Entry → pick type → rule sort → review (Move / Place) → apply → converted entry with an Undo toast. Review can go back to type choice.

Review shows every sorted piece under its field with a Move button. Text no rule matched sits in Unsorted with a Place button. Undo restores the entry exactly as it was.

## Convert sorting rules

Convert reads the entry line by line and applies these fixed rules in order; the first match wins. Nothing leaves the device.

| Order | Rule | Goes to |
| --- | --- | --- |
| 1 | Linked hub | Travel: trip · Hub: entries |
| 2 | Linked Travel entry | Travel: places · Hub: entries |
| 3 | Any other linked entry | Hub: entries |
| 4 | Numbered line (`1.`, `2)`) | Recipe: steps · Writing: outline |
| 5 | Amount + unit ("2 cups", "200g", "1 tbsp") | Recipe: ingredients |
| 6 | Bullet or checkbox line | Travel: packing · Recipe: ingredients |
| 7 | Contains pack, bring, carry | Travel: packing |
| 8 | Contains ask, book, buy, call, reserve | Travel: todo |
| 9 | Contains serves, servings, minutes, hours | Recipe: servings / time |
| 10 | Contains felt, mood, feeling | Journal: mood |
| 11 | Contains grateful, thankful | Journal: gratitude |
| 12 | Contains a URL | Recipe: source |

**When no rule matches**

- Journal → notes. Writing → draft. Hub → intro.
- Travel and Recipe → Unsorted, which is saved in `fields.unsorted` and shown on the entry.
- Converting back to Quick note flattens every field into the body, in field order.
- Tags and links always carry over unchanged.

## Edge cases

| Case | Behavior |
| --- | --- |
| Delete an entry others link to | Tombstoned. Links to it show a struck-through "Deleted note" chip that can be removed. Undo toast for a few seconds. |
| Rename an entry | Nothing else changes; links store IDs and display the new title. |
| Delete a hub | Its entries stay. The hub disappears from their "In hubs" list. |
| Link to self | Not offered in the picker or autocomplete. |
| Same link added twice | Ignored. |
| Tag typed as `#Recipes ` | Saved as `recipes` (trimmed, lowercase, `#` removed). Plurals are not merged. |
| Empty library | View all shows "No notes yet" and the Quick note button. |
| Search or filter finds nothing | "No matches" with a Clear filters button. |
| Entry of an unknown type arrives by sync | Shown as a Quick note; its fields are kept untouched. |
| Same entry edited on two devices | Newer `updatedAt` wins for the whole entry. |

## LIFEMan integration

Notes plugs into LIFEMan's existing storage, sync and themes rather than adding new systems.

- **Replaces the current Notes section.** Its nav spot, icon and home tile carry over.
- **Migration:** on first launch, each existing note becomes a Quick note with its title, text and original date. It runs once, and the old notes data is kept untouched until the user confirms everything moved.
- **Storage:** entries saved in the same local store the other sections use.
- **Sync:** entries sync as individual records through the opt-in Firebase sync. Merge by `updatedAt`; deletions travel as tombstones.
- **Themes:** every aesthetic theme defines the six `--note-*` color tokens.
- **Backup:** entries are included in LIFEMan's existing export and import.
- **Projects:** no Project type in LIFEMan. Projects, dependencies and owners stay in TASKMan; a note or hub can hold a link to a TASKMan project.

**Open questions (answer from the current `lifemaster.html`)**

- [ ] What fields do current notes have, and do any (tags, pins, folders) need a home in the new model?
- [ ] Which local store and key structure should entries use?
- [ ] Does the backup format need a version bump for entries?
- [ ] What does a TASKMan project link look like (URL, project ID, or both), and does it open TASKMan directly?

### Recipe to Meal import

Any Recipe entry can be sent to the Diet section's Meal Builder as a Meal. Mismatched ingredients are fixed through prompts before the Meal is saved.

**Flow**

1. A **Send to Meal Builder** button on Recipe entries starts the import.
2. Each ingredient line is read as amount, unit and name ("200g spinach" → 200, g, spinach).
3. Each name is matched to a Diet food: saved mapping first, then exact name, then all words matching.
4. A review screen lists every ingredient with its status, then saves the Meal with the recipe's servings.

| Status | Shown as | Repair prompt |
| --- | --- | --- |
| Matched | Food name and its calories | None; can still be changed |
| Close match | "Did you mean Spinach, raw?" | Confirm, or pick another food |
| Not found | "No food for byrek dough" | Create the food (name, calories, macros), pick an existing one, or skip it |
| Unit mismatch | "2 cups, but this food is tracked in grams" | Enter the gram weight, or pick a unit the food supports |
| No amount | "Salt (no amount)" | Enter an amount, or skip it |

**Rules**

- Confirmed matches are remembered (ingredient name → food), so the next import matches automatically.
- Skipped ingredients are listed on the Meal as "not counted," so totals are never silently wrong.
- The import is one-way. Editing the Meal never changes the recipe.
- The Meal stores the recipe's ID, and the recipe shows a chip linking to its Meal.
- If the recipe changes later, its chip shows "Recipe updated" with a Re-import option. Nothing updates automatically.

**Open questions (answer from the current Meal Builder code)**

- [ ] How does the Meal Builder store foods, units and nutrition (per 100 g, per serving, or both)?
- [ ] Do Meals have a servings count?
- [ ] Should new foods created during import go into the shared food list?

### Shopping lists

The Meal Builder plans a shopping list from chosen Meals and saves it as a checklist note in Notes.

**Flow**

1. In the Meal Builder, **Plan shopping** opens a picker of Meals, each with a servings count.
2. The ingredients of every chosen Meal are combined into one list.
3. A review screen shows the list; items can be edited, removed or added.
4. Saving creates a Quick note titled "Shopping · <date>", tagged `shopping`, with one checklist item per ingredient and links to the source recipes.

**Combining rules**

- Same food in the same unit → amounts added (200 g + 150 g spinach → 350 g).
- Convertible units are converted before adding (g and kg, ml and l).
- Different units that don't convert → separate lines (2 cups flour and 100 g flour).
- Amounts scale with the servings chosen for each Meal.
- Ingredients skipped during Meal import are still listed, from the recipe's original text, so nothing is forgotten.

**Using the list**

- Items are ticked off from View mode, like any checklist.
- **Update list** re-runs the plan if Meals change; items that stayed the same keep their checked state.
- Shopping lists appear in View all like any note and can be favorited.

**Open questions**

- [ ] Does the Meal Builder already plan Meals by day or week, and should shopping use that plan?
- [ ] Should list items be grouped by store section (produce, dairy), which would need a category on each food?

## Build phases

Five phases, each shippable on its own and tested before the next starts.

| Phase | Scope | Done when |
| --- | --- | --- |
| 1. Capture | Migration of current notes, Quick notes, formatting, checklists, favorites, View all, search, type filter, sort, tags and suggestions | Every existing note migrates with its date; create, edit and delete work offline; all four sorts order correctly; checkboxes toggle and save from View mode; suggestions appear; entries survive reload and sync |
| 2. Links | Link picker, `[[` autocomplete, link chips, backlinks, jump-to, link previews, unlinked mentions | See Phase 2 scope below |
| 3. Hubs | Hub view, ordering, context lines, Add to hub | Order persists across reload and sync; hubs inside hubs work; entries list their hubs |
| 4. Types | Type colors, templates, Convert, rule sort, review, Undo | Every type converts both ways; unmatched text is never lost; Undo restores the original |
| 5. Meals | Send to Meal Builder, ingredient matching, repair prompts, remembered matches, recipe and Meal chips, shopping lists | A recipe with a missing food, a close match and a unit mismatch imports correctly after prompts; re-importing it needs no prompts; skipped items are marked on the Meal; a shopping list combines and scales correctly |

### Phase 2 scope: Links

Phase 2 makes entries link to each other in both directions. It builds on Phase 1 and uses only the `links` field and `[[id]]` tokens already in the data model.

| Item | Details |
| --- | --- |
| Link index | Built on load: outgoing links, backlinks and a title index. Updated on every save, delete and incoming sync, not rebuilt from scratch. |
| `[[` autocomplete | Opens on typing `[[`. Matches every typed word anywhere in a title, in any order, ignoring case. Titles that start with the typed text rank first, then recent; up to 5 results. No aliases. Hubs are marked. Excludes the current entry and deleted entries. Escape or `]]` closes it. |
| Create as new note | Creates an empty Quick note with the typed title, links to it, and keeps you in the current entry. |
| Tokens while editing | Edit mode shows `[[Title]]`, not the raw ID. On save each bracket resolves back to an ID: the original mapping first, then an exact title match. No match → prompt to create the note or remove the brackets. |
| Tokens while viewing | Shown as link text in the target's type color; tapping opens the target. Deleted target → struck-through "Deleted note". Target not on this device yet → "Missing note". |
| Link picker | The sheet from the mockup. Link / Linked toggles update `links` immediately. |
| Links section | Chips for all outgoing links. Picker links have a remove (×) button. Links from the text are marked "in text" and are removed by editing the text. |
| Linked from section | Every backlink, newest first. Each shows the linking entry's title on one line and the sentence containing the link below it. Hub membership joins this list in Phase 3. |
| View all | Cards show outgoing and backlink counts. Expanded cards show both sets of chips. |
| Jump-to and back | Tapping a chip opens that entry, or clears filters and expands its card in View all. A back stack returns you to where you were. |
| Sync | Incoming entries update the index. "Missing note" chips resolve once the target arrives. |
| Link preview | Press and hold an inline link to see a small card: the target's title, then its first sentence. Same card design as a Linked from item. Tap the card to open the entry; release to stay. |
| Unlinked mentions | Below Linked from, list entries whose text contains this entry's title as whole words, ignoring case, but not as a link. Each row shows the title and the sentence, plus a Link it button that turns that text into a link. Titles shorter than 4 characters are skipped. |

**Out of scope for Phase 2:** hubs, aliases, graph view.

**Acceptance checks**

- [ ] A link made with the picker appears on both entries immediately.
- [ ] A `[[` link survives saving, and renaming the target updates it everywhere.
- [ ] Editing the title inside `[[ ]]` to another existing title relinks correctly.
- [ ] Typing words in any order finds the matching title.
- [ ] Linked from shows each linking entry's title and its sentence.
- [ ] Holding an inline link shows the preview card.
- [ ] Unlinked mentions appear, and Link it creates a working link that then leaves the list.
- [ ] Deleting a target shows the deleted chip; Undo restores the link.
- [ ] Removing a link also removes the backlink on the other entry.
- [ ] No self-links or duplicate links can be created.
- [ ] Links survive reload, export and import, and sync between two devices.
- [ ] With 1,000 entries, autocomplete, saving and unlinked mentions show no noticeable delay.

## Backlog

Saved for later; not part of phases 1–5.

- **Smart linking:** suggest hubs by shared tags, show related notes.
- **Smart hubs:** hubs defined by a saved filter that fill themselves.
- **Capture:** per-type quick capture, a Today journal button, natural-language dates.
- **On This Day:** a card showing entries written on today's date in past years.
- **Locked notes:** individual entries hidden behind a passcode or device unlock, for a private journal.
- **Gallery and calendar views:** show any filtered set of entries as a card gallery or on a month calendar, alongside the list.
- **Finding:** fuzzy search, recent entries, link-count badges.
- **Organizing:** rename and merge tags, entry icons, a Rediscover card.
- **Type extras:** travel entries on a map, recipe import from a URL.
- **Rules:** custom keywords per template (rules are fixed for now).
- **Cross-section links:** link notes to other LIFEMan data.

AI sorting was considered and dropped.
