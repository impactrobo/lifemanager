# Count units and size tiers

**Status: scoped, not started.** Raised 2026-09-27: *"There are some conversions for 'stick of
butter' and 'small / medium / large onion' for example that may allow for conversion to weight based
on an ingredient-dependent input."*

This is the candidate list and the sourcing plan. It is a build spec, not a shipped feature — every
gram figure below is **indicative and must be verified against a source before it goes in the code**
(see [Sourcing](#sourcing)).

---

## The problem

The ingredient parser handles *amount + unit + name*. A line with no recognised unit comes back as
`status: 'unit'` or `'noamount'` and has to be fixed by hand, once per line, every time:

| Written | Today | Wanted |
|---|---|---|
| `2 sticks butter` | no unit → asks | 226 g |
| `3 cloves garlic` | no unit → asks | 9 g |
| `1 large onion` | no unit → asks | 150 g |
| `2 medium carrots` | no unit → asks | 122 g |
| `1/2 stick butter` | no unit → asks | 57 g |

These are the lines people actually write. Recipes are not written in grams.

## Two mechanisms, built in this order

**1. A fixed count word.** A stick of butter is 113 g; a clove of garlic is ~3 g; an egg is 50 g.
One word, one number, no ambiguity. The app already models this — the `count` food kind carries
`itemAmount` + `itemLabel`, and eight foods use it today (egg, yolk, square of chocolate, scoop of
whey, capsule, scoop of creatine, can of soda, tender). What is missing is:

- the **parser knowing the word** (`MATCH_UNITS` has no `stick`, `clove`, `slice`, …), and
- a food being allowed **more than one** count word — an egg is also weighable, a banana is sold by
  the piece and cooked by the gram.

**2. Size tiers.** Small / medium / large. A second axis, and the honest shape is a per-ingredient
table rather than a global multiplier, because the ratios differ per food:

```
onion   { small: 70,  medium: 110, large: 150 }    large ≈ 2.1× small
potato  { small: 170, medium: 213, large: 369 }    large ≈ 2.2× small
egg     { small: 38,  medium: 44,  large: 50  }    large ≈ 1.3× small
```

An onion's large-to-small ratio is not an egg's. One multiplier would be wrong for both.

---

## Tier A — foods already in FOOD_DB

These need only a count word and/or a size table. No new food records.

### A1. Fixed count, no size tier

The word means one thing. Highest value per unit of work — build these first.

| Food (`id`) | Count word(s) | Grams | Confidence |
|---|---|---|---|
| `garlic` | clove | 3 | High |
| `eggs_whole` | egg *(has it)* | 50 | Shipped |
| `egg_yolk` | yolk *(has it)* | 17 | Shipped |
| `celery` | stalk, rib | 40 | High |
| `bacon` | slice, rasher, strip | 8 *(cooked)* | Check |
| `seaweed_nori` | sheet | 2.5 | Check |
| `dark_chocolate` | square *(has it)* | 10 | Shipped |
| `soda` | can *(has it)* | 355 | Shipped |

**Note on `bacon`:** the food is *"Bacon, cooked"*, so the per-slice figure must be the **cooked**
weight (~8 g), not the raw rasher (~28 g). Getting this backwards triples the calories of every
recipe that says "2 slices bacon". Worth a comment in the data.

### A2. Size-tiered produce

`small` / `medium` / `large`, with **medium as the default** when the line says just "1 onion".

| Food (`id`) | small | medium | large | Confidence |
|---|---|---|---|---|
| `onion` | 70 | 110 | 150 | High |
| `potato` | 170 | 213 | 369 | High |
| `tomato` | 91 | 123 | 182 | High |
| `carrots` | 46 | 61 | 72 | High |
| `red_bell_pepper` | 78 | 119 | 164 | High |
| `banana` | 101 | 118 | 136 | High |
| `orange` | 96 | 131 | 184 | High |
| `kiwi` | 46 | 69 | 91 | Check |
| `sweet_potato` | 60 | 114 | 180 | Check |
| `zucchini` | 118 | 196 | 323 | Check |
| `cucumber` | 158 | 201 | 301 | Check |
| `avocado` | 136 | 201 | 230 | Check |
| `mushrooms` | 10 | 18 | 28 | Check |

Several of these also want a **fixed count word** alongside the tiers — a clove is a clove, but
"1 head of garlic" ≈ 10 cloves, and "1 head of cauliflower" is a real unit:

| Food | Extra word | Grams | Confidence |
|---|---|---|---|
| `garlic` | head, bulb | 34 (≈11 cloves) | Check |
| `cauliflower` | head | 588 | Check |
| `cabbage` | head | 908 | Check |
| `broccoli` | head, crown | 608 | Check |
| `romaine_lettuce` | head | 626 | Check |
| `corn` | ear, cob | 90 *(kernels, cooked)* | Check |

**`corn` is the trap in that list.** The food is *"Corn, cooked"* — kernels. An ear of corn weighs
~250 g whole but yields ~90 g of kernels. The number that belongs in the table is the one that
matches what the food record measures, not what you carry home.

---

## Tier B — foods that don't exist yet

**The headline finding: there is no butter in FOOD_DB.** 122 foods, and the very example that
prompted this can't be matched at all — "stick of butter" fails before it reaches the unit question.
Searching the DB for the obvious count-written ingredients:

| Ingredient | In FOOD_DB? |
|---|---|
| Butter | ❌ *(only "Peanut butter")* |
| Bread | ❌ |
| Lemon | ❌ |
| Lime | ❌ |
| Apple | ❌ *(only "Apple juice")* |
| Shallot | ❌ |
| Ginger | ❌ |
| Scallion / spring onion | ❌ |
| Tortilla | ❌ |
| Sausage | ❌ |

So **this feature has a prerequisite**, and it is a bigger one than the feature: roughly 10–20 new
food records, each needing a full `per100` macro + micronutrient profile, before a single count word
becomes useful. That is the real cost, and it should be decided on its own merits rather than
smuggled in as "part of the parser work".

Proposed additions, in rough order of how often they appear in written recipes:

| Food | Count word(s) | Grams | Size tiers? | Confidence |
|---|---|---|---|---|
| Butter, salted / unsalted | **stick** | **113** | no | **Definitional** |
| | tbsp *(already a unit)* | 14.2 | | Definitional |
| | pat | 5 | | Check |
| Bread, sliced | slice | 28 | no | Check |
| Lemon | — | — | 58 / 84 / 108 | Check |
| | juice of 1 | ~45 mL | | Check |
| Lime | — | — | 44 / 67 / 91 | Check |
| Apple | — | — | 149 / 182 / 223 | High |
| Shallot | — | — | 25 / 40 / 60 | Check |
| Ginger, fresh | thumb, knob | 15 | no | Check |
| Scallion / spring onion | — | 15 | no | Check |
| Tortilla, flour | tortilla | 45 | no | Check |
| Sausage, pork | link, sausage | 75 | no | Check |

**"Stick of butter" is the one number here that is definitional rather than measured.** A US stick is
¼ lb by law of the wrapper: 4 oz = 113.4 g = 8 tbsp. It does not need a database. It is also
**US-only** — butter elsewhere is sold in 250 g blocks and nobody says "stick" — which matters
because the app already made a deliberate choice to speak US units.

---

## Deliberately out of scope

| Pattern | Why not |
|---|---|
| `1 bunch parsley` | A bunch is whatever the shop banded together. Range is 40–150 g. |
| `1 can tomatoes` | Depends entirely on the can; 400 g is common but not a rule. Better as a size tier on a new "Canned tomatoes" food than as a count word. |
| `1 handful spinach` | Not a unit. It's a gesture. |
| `a splash of`, `a knob of` | Same. |
| `to taste`, `for serving` | Already correctly skipped — these should stay in the "not counted" box, which is the honest answer. |
| `1 packet yeast` | Real (7 g) but irrelevant to macros. |

The line: **a count word earns its place when the number is stable enough that a user reading the
macro total would not feel misled.** A clove passes. A handful doesn't.

---

## Sourcing

The user's note: *"There are several databases out there to pull the info from."* Agreed — and the
one that already matches this app's shape is:

### USDA FoodData Central (primary)

<https://fdc.nal.usda.gov/> · free API, no licence restriction on the data.

The relevant piece is **`foodPortions`** on a *SR Legacy* or *Foundation Foods* entry. Each portion
carries a human description and a gram weight — precisely the pair this feature needs:

```
portionDescription: "1 medium (2-1/2" dia)"   gramWeight: 110
portionDescription: "1 large"                  gramWeight: 150
portionDescription: "1 clove"                  gramWeight: 3
```

So the extraction is: for each candidate food, find its FDC entry, read `foodPortions`, and keep the
portions whose description matches a word we care about. This is a **one-time script producing a
table that gets committed**, not a runtime API call — the app is local-first and offline-capable, and
a shopping list that needs the network to add up would be a regression.

Two cautions:

- **Match the FDC entry to the FOOD_DB entry's state.** `Bacon, cooked` must take portions from a
  cooked entry. Raw-vs-cooked is the single biggest source of a wrong number here.
- Confirm the exact API field names against the live docs before writing the script. The shape above
  is from memory and the API has changed before.

### Secondary / cross-check

- **USDA SR Legacy PDF tables** — the same data, human-readable, good for spot-checking a handful of
  values without writing anything.
- **Package labelling** for manufactured items (butter, bread, tortillas) — more authoritative than
  a database average, because these are defined amounts rather than measured ones.

### What NOT to use

Recipe-site conversion tables and the "how much does an onion weigh" blog genre. They agree with each
other because they copy each other, and none of them cite anything.

---

## Data shape

Proposed, following the existing `count` food kind rather than inventing a parallel one:

```js
// On a FOOD_DB record:
counts: {
  clove: 3,                                  // a fixed count word
  head:  34,
},
sizes: { small: 70, medium: 110, large: 150 },   // tiers, medium is the default
```

- `counts` is a map because **one food needs several words** — the reason it isn't the existing
  single `itemAmount`/`itemLabel` pair. Garlic has cloves *and* heads.
- `sizes` is separate from `counts` because a size qualifier modifies the *bare* count ("1 onion"),
  while a count word replaces it ("1 clove"). `1 large clove` is a combination worth ignoring.
- A food may have both, one, or neither.
- **Every value from this path is approximate**, and should be marked as such wherever it reaches a
  macro total. A medium onion is a range; reporting 110 g silently claims more than we know. The app
  already has `approx: true` on some FOOD_DB records — the same flag, set on the *ingredient row*
  rather than the food, is probably the answer.

### And the piece that makes it cheap

For anything not in the table, **ask once and remember** — which is exactly what `ingredientMap`
already does for names. The user confirms "1 stick butter = 113 g" one time, and every later recipe
matches silently. That means the built-in table doesn't have to be complete to be useful; it only has
to cover the common cases so the asking is rare.

---

## Open questions

1. **Is the Tier B food work worth it on its own?** 10–20 new foods with full macro profiles is the
   bulk of this, and it is useful independently of count words. It may want to be its own task.
2. **Size defaults.** Is "1 onion" a medium onion? It is the obvious default, but it is a guess being
   made silently — and the alternative (asking) is the friction this feature exists to remove.
3. **How visible should "approximate" be?** A footnote on the recipe, a marker on the row, or nothing
   at all with the honesty living only in this document.
4. **US-only count words.** "Stick" is US. The app already chose US units deliberately, so this is
   probably fine, but it is a choice being made rather than a fact.
