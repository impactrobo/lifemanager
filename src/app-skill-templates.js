// app-skill-templates.js -- starting points for a new skill, and the one-time guitar carry-across.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). Classic
// <script>, loaded after app-skill-session.js.
//
// ---- Two jobs ----
// A TEMPLATE is a skill you can create pre-filled rather than typing forty items by hand. It is
// pure data: the catalogues it reads still live in app-data.js, because that file is the reference
// data and a template is just a shape over it.
//
// The MIGRATION is the one-time move of STATE.life.guitar into a real Skill. It runs once per save,
// from migrateState(), and only for someone who actually has guitar progress -- a brand-new install
// should not find a Guitar skill it never asked for. It gets the template from the "+ ADD SKILL"
// flow like anyone else.

// A template item is the same shape defaultSkillItem() produces; this only maps the field names.
function buildTemplateList(name, tiered, source, mapFn) {
  const list = defaultSkillList(name, tiered);
  source.forEach(row => {
    const m = mapFn(row);
    list.items.push(defaultSkillItem(m.name, m.detail, m.detail2, m.tier));
  });
  return list;
}

const SKILL_TEMPLATES = [
  {
    key: 'guitar',
    name: 'Guitar',
    blurb: '16 chords, 15 songs and 8 techniques, in difficulty tiers.',
    // Three catalogues that were three hardcoded screens. Strip the naming and they were always the
    // same object wearing different field names -- which is the observation the whole Skill model
    // came out of, so guitar makes a fitting first template.
    build: () => [
      buildTemplateList('Chords', true, GUITAR_CHORDS,
        c => ({ name: c.chord, detail: c.why, detail2: c.type, tier: c.tier })),
      buildTemplateList('Songs', true, GUITAR_SONGS,
        s => ({ name: s.song, detail: s.artist, detail2: s.genre, tier: s.tier })),
      // Flat, because the technique catalogue never had a tier field -- the one real difference
      // between the three, and `tiered: false` is exactly the knob for it.
      buildTemplateList('Techniques', false, GUITAR_TECHNIQUES,
        t => ({ name: t.name, detail: t.what, detail2: '', tier: 1 })),
    ],
  },
];
function skillTemplate(key) { return SKILL_TEMPLATES.find(t => t.key === key) || null; }

function createSkillFromTemplate(key) {
  const tpl = skillTemplate(key);
  if (!tpl) return;
  if (!Array.isArray(STATE.skills)) STATE.skills = [];
  const skill = defaultSkill(tpl.name);
  skill.lists = tpl.build();
  STATE.skills.push(skill);
  UI.skillFormOpen = false;
  saveState();
  openSkill(skill.id);
}

// ---- The one-time guitar carry-across ----
//
// The old model tracked progress by ARRAY INDEX into a shipped constant -- `g.chordStatus[3]` meant
// "whatever sits 4th in GUITAR_CHORDS today" -- with three status maps, two date maps and nothing
// guarding any of it. This is the last moment that mapping is provably correct, because the
// catalogues have not changed since launch: read it now, by index, once, and never again.
//
// ---- How the three states map onto the ladder, and why not higher ----
//
//   0  not started  -> untouched. reps 0, interval 0, no date. Reads NEW.
//   1  learning     -> reps 2, interval 1. Phase A, mid-taper. Reads LEARNING.
//   2  learned      -> reps 5, interval 3. Reads PROFICIENT.
//
// That last row is the judgment call. It is tempting to map "learned" to EXPERT, and it would be
// over-claiming: the ladder defines PROFICIENT as "can do it, still needs attention" and EXPERT as
// "reliable, out of every session". The old model had no rating, no interval and no ease -- nothing
// in it could tell "played it right once" from "have it cold", so it cannot support a claim about
// reliability. PROFICIENT is the highest rung the old data honestly reaches, and one clean session
// moves it up from there.
//
// Ease stays at the default for everything, because the old model had nothing resembling difficulty.
const SKILL_MIGRATE_STATE = {
  1: { reps: 2, interval: 1 },
  2: { reps: 5, interval: 3 },
};

function migrateGuitarToSkill() {
  const g = STATE.life && STATE.life.guitar;
  if (!g || g.migratedToSkill) return null;
  // Stamped even when there is nothing to carry, so this can never run a second time -- including
  // for someone who starts guitar progress AFTER the migration ships, whose data belongs to the
  // real Skill by then.
  g.migratedToSkill = true;

  const statusOf = (map, i) => Math.max(0, Math.round(Number(map && map[i]) || 0));
  const anyProgress = GUITAR_CHORDS.some((c, i) => statusOf(g.chordStatus, i) > 0)
    || GUITAR_SONGS.some((s, i) => statusOf(g.songStatus, i) > 0)
    || GUITAR_TECHNIQUES.some((t, i) => statusOf(g.techStatus, i) > 0)
    || (g.practiceLog || []).length > 0;
  // A fresh install has nothing to carry and should not find a Guitar skill it never asked for.
  // The template is still there under "+ ADD SKILL".
  if (!anyProgress) return null;

  const today = todayStr();
  const skill = defaultSkill('Guitar');
  skill.lists = skillTemplate('guitar').build();

  // By index, deliberately and for the last time. Each list is walked against the catalogue it was
  // built from, in the order it was built, which is the only place that correspondence is allowed
  // to exist -- after this the items carry their own ids and the parallel structure is gone.
  const carry = (listIdx, catalogue, statusMap, dateMap) => {
    const items = skill.lists[listIdx].items;
    catalogue.forEach((row, i) => {
      const status = statusOf(statusMap, i);
      const move = SKILL_MIGRATE_STATE[status];
      const item = items[i];
      if (!move || !item) return;
      item.reps = move.reps;
      item.interval = move.interval;
      // Everything carried across comes up once in the first session after the migration. The
      // mapping above is a guess at where you are; one honest rating replaces it with data, and
      // that is worth far more than preserving a schedule the old model never actually had.
      item.dueIn = 0;
      // The recorded date where there is one, else the migration date. This is also why a chord
      // learned eight months ago correctly reads as STALE straight away -- that falls out of the
      // model rather than needing its own rule. Techniques have no date map at all, which is the
      // old bug that kept them off their own timeline; they get today and join the rest.
      item.lastPractised = (dateMap && dateMap[i]) || today;
    });
  };
  carry(0, GUITAR_CHORDS, g.chordStatus, g.chordLearnedDate);
  carry(1, GUITAR_SONGS, g.songStatus, g.songLearnedDate);
  carry(2, GUITAR_TECHNIQUES, g.techStatus, null);

  skill.practiceLog = (g.practiceLog || []).map(e => ({
    id: e.id || uid(), date: e.date, minutes: Number(e.minutes) || 0, notes: e.notes || '',
    // These predate the session engine, so they moved nothing by definition.
    moves: [],
  }));

  if (!Array.isArray(STATE.skills)) STATE.skills = [];
  STATE.skills.push(skill);
  // STATE.life.guitar is deliberately NOT deleted. The screens retire; the data stays exactly where
  // it was, so a mapping that turns out wrong can be redone against the original rather than
  // reconstructed from what this function produced.
  return skill;
}
