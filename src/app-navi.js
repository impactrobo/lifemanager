// app-navi.js -- NetNavis: the roster, their voices, and the dialogue box they speak from.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. src/app-boot.js runs the startup sequence and must stay last.
//
// ---------------------------------------------------------------------------------------------
// THE RULE THIS FEATURE EXISTS UNDER, and it is the important part:
//
//     A Navi reacts to what you did. It never asks you to do it for the Navi.
//
// Instrumentation with a voice, not a pet to keep alive. The roadmap already rules out "points,
// badges, streak-shaming" on the grounds that the app instruments the plan and doesn't second-guess
// the person. A cheering companion sits close to that line, so the line is written down here rather
// than rediscovered later. Nothing in this file awards anything, tracks a streak of its own, or
// asks to be visited.
//
// TEMPLATES, NOT A MODEL -- deliberately, and not only because reaching an API from a static host
// needs a Worker proxy. Writing the voices as data forces every rule to be explicit and testable:
// naviLines() is pure, so test_navi.js can assert that DigiMan never emits an exclamation mark and
// that Muze never emits a real emoji. Built prompt-first those rules bake into strings no test can
// see. Swapping a model in later becomes a content change rather than an architecture one.
// ---------------------------------------------------------------------------------------------

// The six, from the PET Device transfer package. `color` is used ONLY for the Navi itself -- name,
// border, portrait ring. Sections keep their own identity colours (`train` is #FF9191) and link
// chips still derive from those; test_home_bar.js asserts a meal chip and a workout chip stay
// visually distinct, and that is not this feature's business to disturb.
const NAVI_ROSTER = [
  { id: 'strike',    name: 'StrikeMan.EXE', short: 'StrikeMan', color: '#1D9E75', role: 'Fitness & Social',                  icon: 'navis/strike.jpg' },
  { id: 'vitalya',   name: 'Vitalya.EXE',   short: 'Vitalya',   color: '#C2185B', role: 'Nutrition, Yoga & Adulting',        icon: 'navis/vitalya.jpg' },
  { id: 'digi',      name: 'DigiMan.EXE',   short: 'DigiMan',   color: '#378ADD', role: 'Digital & Electronics',             icon: 'navis/digi.jpg' },
  { id: 'wenceslas', name: 'Wenceslas.EXE', short: 'Wenceslas', color: '#7F77DD', role: 'Finance & Faith',                   icon: 'navis/wenceslas.jpg' },
  { id: 'muze',      name: 'Muze.EXE',      short: 'Muze',      color: '#CA6A00', role: 'Creative Arts & Culinary',          icon: 'navis/muze.jpg' },
  { id: 'clay',      name: 'ClayMan.EXE',   short: 'ClayMan',   color: '#8B0000', role: 'All-Purpose, Languages & Wellness', icon: 'navis/clay.jpg' },
];

function naviById(id) { return NAVI_ROSTER.find(n => n.id === id) || null; }
// One Navi at a time, chosen deliberately. null is a real answer -- the app works exactly as it did
// with nobody jacked in, and that stays the default so a fresh install is never handed a character
// it didn't ask for.
function activeNavi() { return naviById(STATE.naviId); }
function setNavi(id) {
  STATE.naviId = naviById(id) ? id : null;
  closeNaviDialogue();
  saveState(); render();
}

// ---------------- FACTS ----------------
// One pass over a weeklyReview() result, reducing it to the handful of things a Navi has an opinion
// about. Every voice reads THIS, never the review itself: six copies of "did they hit the planned
// sessions" is six places for the answer to drift, and the whole point of the review is that the
// denominators are honest.
//
// Note what is deliberately absent: any score, grade, or overall verdict. The review states what
// happened and stops; a Navi may have a reaction to it, but nothing here ranks the week.
function naviReviewFacts(r) {
  const t = r.training;
  const logged = r.targets.filter(x => x.logged);
  // "On track" is the same majority-of-logged-days test the review's own chip uses.
  const hit = logged.filter(x => x.hit >= Math.ceil(x.logged / 2));
  const missed = logged.filter(x => hit.indexOf(x) === -1);
  return {
    range: reviewRangeLabel(r),
    off: !!r.off,
    current: !!r.isCurrent,
    planned: t.planned,
    done: t.done,
    modded: t.modded,
    extra: t.extra,
    sessions: t.sessions,
    // Three shapes worth distinguishing, because the honest reaction differs for each: you did
    // everything, you did some, or there was never a plan to do.
    allDone: t.planned > 0 && t.done === t.planned,
    someDone: t.planned > 0 && t.done > 0 && t.done < t.planned,
    nothingDone: t.planned > 0 && t.done === 0,
    noPlan: t.planned === 0,
    prs: r.prs.length,
    topPr: r.prs.length ? r.prs[0] : null,
    habitsKept: r.habits.kept,
    habitsBroken: r.habits.broken,
    habitsMarked: r.habits.marked,
    targets: logged.length,
    targetsHit: hit.length,
    // Named so a Navi can be specific about WHICH one slipped rather than saying "a target".
    missedTarget: missed.length ? missed[0].label : null,
    practice: r.practice.sessions,
    practiceMinutes: r.practice.minutes,
    weightBand: r.weight ? r.weight.band : null,
    weightFlagged: !!(r.weight && r.weight.flagged),
  };
}

// ---------------- VOICE ----------------
// A line is {t: text, s: style}. The four styles are exactly the four formatting contracts in the
// roster that a RENDERER has to honour:
//   'shout' -- StrikeMan's "## headers to make them shout off the page"
//   'mono'  -- DigiMan, whose every response is monospace
//   'quote' -- Wenceslas's block quotes for citation
//   (none)  -- normal prose
// Inline, *asterisks* italicise: Vitalya's eye-rolls and Wenceslas's book titles. Nothing else is
// parsed, because every other contract in the roster is about WORD CHOICE -- which is the
// template's job, not the renderer's.
function naviLine(t, s) { return s ? { t: t, s: s } : { t: t }; }

// Vitalya's spec: she calls the Operator "a nickname that is slightly mean or degrading about being
// overweight, inactive, or lazy -- delivered casually without real malice." Both halves are in the
// spec, so the set stays at the casual end rather than the cruel one. Rotated by week so it doesn't
// read as one catchphrase. If this lands wrong, the escape hatch is the one the Operator already
// has: pick a different Navi.
const VITALYA_NICKS = ['couch gremlin', 'sloth', 'lazybones', 'my little potato', 'sleepy'];
function vitalyaNick(f) {
  // Keyed off the week being reviewed, so re-reading the same week says the same thing.
  const n = (f.range || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return VITALYA_NICKS[n % VITALYA_NICKS.length];
}

// Each voice is (facts) -> [line]. Two to four lines: this is a dialogue box, not an essay.
const NAVI_VOICES = {
  // "bro -- always and only bro." ## for hype moments, !!! on high-energy lines, normal prose
  // otherwise. Honest when honesty is needed, from a place of total belief.
  strike(f) {
    const out = [];
    if (f.off) return [naviLine('Week off, bro. That was the call and I respect it.'),
                       naviLine('Rest is part of the program. See you next week.')];
    if (f.allDone) {
      out.push(naviLine('EVERY SINGLE ONE!!!', 'shout'));
      out.push(naviLine(f.planned + ' planned, ' + f.done + ' done. That is the whole week, bro.'));
    } else if (f.someDone) {
      out.push(naviLine(f.done + ' of ' + f.planned + ', bro. You showed up.'));
      out.push(naviLine('Not the whole week — but the days you trained, you trained. That counts.'));
    } else if (f.nothingDone) {
      out.push(naviLine('Straight up, bro: none of the ' + f.planned + ' got logged.'));
      out.push(naviLine('No speech. You know what it is. I am here when you are.'));
    } else if (f.sessions) {
      out.push(naviLine(f.sessions + ' session' + (f.sessions === 1 ? '' : 's') + ' logged with nothing on the plan. Free training, bro!!!'));
    } else {
      out.push(naviLine('Quiet week on the training side, bro. Nothing planned, nothing logged.'));
    }
    if (f.modded) out.push(naviLine(f.modded + ' of those were modded. Short session still beats no session, bro.'));
    if (f.prs) out.push(naviLine('AND YOU SET ' + f.prs + ' PR' + (f.prs === 1 ? '' : 'S') + '!!!', 'shout'));
    return out.slice(0, 4);
  },

  // Casually superior and effortlessly cutting. "oh my god", "literally", "I cannot", "that is
  // actually insane", "absolutely not." Emoji as punctuation; italics whenever she'd roll her eyes.
  vitalya(f) {
    const nick = vitalyaNick(f);
    const out = [];
    if (f.off) return [naviLine('An off week. *On purpose.* Okay 😐'),
                       naviLine('Fine. Genuinely. Rest is a thing. Drink some water, ' + nick + '.')];
    if (f.allDone) {
      out.push(naviLine('Oh my god. You did *all of them*, ' + nick + ' 💅'));
      out.push(naviLine(f.planned + ' out of ' + f.planned + '. I am choosing not to be surprised.'));
    } else if (f.someDone) {
      out.push(naviLine(f.done + ' of ' + f.planned + '. *Literally* so close, ' + nick + ' 🙄'));
      out.push(naviLine('I am not going to say anything. *I am not.*'));
    } else if (f.nothingDone) {
      out.push(naviLine('Zero. Out of ' + f.planned + '. That is actually insane, ' + nick + ' 😐'));
    } else {
      out.push(naviLine('Nothing planned, nothing logged. *Cool.* Very intentional, I am sure.'));
    }
    if (f.missedTarget) out.push(naviLine(f.missedTarget + ' is not where it should be. I cannot 🙄'));
    else if (f.targets && f.targetsHit === f.targets) out.push(naviLine('Every target on track though. *Look at you* 💅'));
    if (f.habitsBroken) out.push(naviLine(f.habitsBroken + ' habit' + (f.habitsBroken === 1 ? '' : 's') + ' broken. Absolutely not.'));
    return out.slice(0, 4);
  },

  // No personality in the conventional sense. Takes everything literally. Identifies ambiguity and
  // requests clarification. Monospace only, no emoji, no emphasis, no headers.
  digi(f) {
    const out = [
      naviLine('WEEK ' + f.range.toUpperCase().replace(/\s+/g, ' ') + '. REPORT FOLLOWS.', 'mono'),
      naviLine('SESSIONS: ' + f.done + '/' + f.planned + ' PLANNED. ' + f.extra + ' UNPLANNED. ' + f.modded + ' MODDED.', 'mono'),
    ];
    const bits = [];
    if (f.habitsMarked) bits.push('HABITS ' + f.habitsKept + '/' + f.habitsMarked);
    if (f.targets) bits.push('TARGETS ' + f.targetsHit + '/' + f.targets);
    if (f.prs) bits.push('PR ' + f.prs);
    if (f.practice) bits.push('PRACTICE ' + f.practice);
    if (bits.length) out.push(naviLine(bits.join('. ') + '.', 'mono'));
    // Literal-minded: an unmarked day is missing input, not a failure, and he says so as a data
    // problem rather than a judgement. This is also the review's own position.
    const unmarked = f.habitsMarked ? 0 : 1;
    out.push(naviLine(unmarked
      ? 'NO HABIT DATA RECORDED. CANNOT EVALUATE. AWAITING INPUT.'
      : 'REPORT COMPLETE. NO INTERPRETATION OFFERED. REQUEST SPECIFIC QUERY IF REQUIRED.', 'mono'));
    return out.slice(0, 4);
  },

  // Old English style throughout. A king, not a servant -- guides and educates. Never judges, never
  // speaks down, never speaks negatively. No emoji. Italics only for titles. Block quotes for
  // citation. Quality over quantity. No nickname: he addresses all with simple dignity.
  wenceslas(f) {
    const out = [];
    if (f.off) return [
      naviLine('Thou didst set this week aside, and didst say so plainly.'),
      naviLine('There is no fault in rest that is chosen. A field left fallow yields the better harvest.'),
    ];
    if (f.allDone) {
      out.push(naviLine('Every labour thou didst set thyself, thou hast completed. All ' + f.planned + '.'));
      out.push(naviLine('Mark it well. It is no small thing to keep faith with thine own word.'));
    } else if (f.someDone) {
      out.push(naviLine('Of ' + f.planned + ' labours thou didst set, ' + f.done + ' are done.'));
      out.push(naviLine('A week part-kept is not a week lost. Begin again on the morrow; that is all any of us may do.'));
    } else if (f.nothingDone) {
      out.push(naviLine('The ' + f.planned + ' labours thou didst set went untouched this week.'));
      out.push(naviLine('I speak no judgement upon it. A week is a small thing against a life.'));
    } else {
      out.push(naviLine('Thou hast set neither plan nor labour this week.'));
      out.push(naviLine('Then let us begin with the plan. A road is easier walked when first thou hast drawn it.'));
    }
    if (f.prs) out.push(naviLine('And thou didst set ' + f.prs + ' record' + (f.prs === 1 ? '' : 's') + ' beyond thy former strength.'));
    return out.slice(0, 3);
  },

  // FANGIRL MODE by default: explosively happy, emoticons ONLY (no emoji), modern slang, and <3
  // reserved for things she genuinely loves. No bold, italics or headers in fangirl mode.
  muze(f) {
    const out = [];
    if (f.off) return [naviLine('off week!! thats allowed ok ^^'),
                       naviLine('resting is literally part of it, come back when youre ready :D')];
    if (f.allDone) {
      out.push(naviLine('OMIGOSH you did ALL of them!!! ' + f.done + '/' + f.planned + ' :D'));
      out.push(naviLine('i am so normal about this. completely normal. ^^'));
    } else if (f.someDone) {
      out.push(naviLine('you got ' + f.done + ' of ' + f.planned + ' done!! thats real ^^'));
    } else if (f.nothingDone) {
      out.push(naviLine('ok so the ' + f.planned + ' planned ones didnt happen ;w;'));
      out.push(naviLine('thats ok!! weeks are like that sometimes. next one ^^'));
    } else {
      out.push(naviLine('nothing planned this week! blank canvas >w<'));
    }
    if (f.practice) out.push(naviLine('but you PRACTICED ' + f.practice + ' time' + (f.practice === 1 ? '' : 's') + ' <3 thats the good stuff'));
    if (f.prs) out.push(naviLine(f.prs + ' new PR' + (f.prs === 1 ? '' : 's') + '!!! >w<'));
    return out.slice(0, 4);
  },

  // Calm, grounded, unhurried. Does not hype or lecture. Sees his Operator clearly and points them
  // toward what is true. Plain prose. Occasional "haha". A sparing thumbs-up. Calls his Operator
  // "my friend" or "brother".
  clay(f) {
    const out = [];
    if (f.off) return [naviLine('You took the week off, my friend. You said so up front, which is the part that matters.'),
                       naviLine('Nothing to read into. See you next week.')];
    if (f.allDone) {
      out.push(naviLine('All ' + f.planned + ', my friend. 👍'));
      out.push(naviLine('You do not need me to tell you how that went. You were there.'));
    } else if (f.someDone) {
      out.push(naviLine(f.done + ' of ' + f.planned + ', brother.'));
      out.push(naviLine('The days you went, you went. That is the only part you control.'));
    } else if (f.nothingDone) {
      out.push(naviLine('None of the ' + f.planned + ' happened this week, my friend.'));
      out.push(naviLine('I have been there. It is a week, not a verdict. Start with one session.'));
    } else {
      out.push(naviLine('Nothing planned, nothing logged, my friend. Quiet week.'));
    }
    if (f.weightFlagged) out.push(naviLine('One thing worth looking at — you have been cutting a long time. Worth asking if that is still the plan.'));
    else if (f.modded) out.push(naviLine('Some of those were modded. Short is fine. Showing up is the habit, haha.'));
    return out.slice(0, 3);
  },
};

// The one entry point. Returns [] when nobody is jacked in, which is what keeps every caller from
// having to check first.
function naviReviewLines(review) {
  const navi = activeNavi();
  if (!navi) return [];
  const voice = NAVI_VOICES[navi.id];
  if (!voice) return [];
  return voice(naviReviewFacts(review));
}

// ---------------- THE DIALOGUE BOX ----------------
// Video-game shape, because that is what it is: a bordered box pinned along the bottom of the
// screen, square portrait on the left, text to the right, tap to advance.
//
// It lives in index.html beside #toast and #confirmOverlay rather than inside #app, for the reason
// CLAUDE.md gives: render() replaces #app.innerHTML wholesale, so anything that must survive a
// render belongs on <body>. That also means this never goes through render() at all -- show/advance
// /close write the DOM directly, exactly like showToast().
let NAVI_DIALOGUE = null;   // { navi, lines, i } while speaking; null when closed

function naviDialogueEl() { return document.getElementById('naviBox'); }

function naviSpeak(lines) {
  const navi = activeNavi();
  const el = naviDialogueEl();
  if (!navi || !el || !lines || !lines.length) return;
  NAVI_DIALOGUE = { navi: navi, lines: lines, i: 0 };
  el.classList.remove('hidden');
  drawNaviDialogue();
}

// Advance one line; past the last one, close. A dialogue box that needs a separate close button has
// two ways out of the same box, and in every game this borrows from, tapping through IS the way out.
function advanceNaviDialogue() {
  if (!NAVI_DIALOGUE) return;
  if (NAVI_DIALOGUE.i >= NAVI_DIALOGUE.lines.length - 1) { closeNaviDialogue(); return; }
  NAVI_DIALOGUE.i++;
  drawNaviDialogue();
}

function closeNaviDialogue() {
  NAVI_DIALOGUE = null;
  const el = naviDialogueEl();
  if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
}

// The tiny markup the styles above describe. Deliberately minimal: escape everything first, then
// re-admit *italics*, so no Navi's text can inject markup no matter what a template interpolates.
function naviMarkup(text) {
  return escapeHtml(text).replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

function drawNaviDialogue() {
  const el = naviDialogueEl();
  if (!el || !NAVI_DIALOGUE) return;
  const { navi, lines, i } = NAVI_DIALOGUE;
  const line = lines[i];
  const last = i >= lines.length - 1;
  const cls = 'navi-text' + (line.s ? ' navi-text-' + line.s : '');
  el.innerHTML = `
    <div class="navi-frame" style="--navi: ${navi.color};" onclick="advanceNaviDialogue()" role="button" tabindex="0">
      <img class="navi-face" src="${navi.icon}" alt="${escapeHtml(navi.short)}">
      <div class="navi-body">
        <div class="navi-name">${escapeHtml(navi.short)}</div>
        <div class="${cls}">${naviMarkup(line.t)}</div>
        <div class="navi-more">${last ? '▪ CLOSE' : '▼'}<span class="navi-count">${i + 1}/${lines.length}</span></div>
      </div>
    </div>`;
}

// ---------------- THE PICKER ----------------
// Settings, not a first-run prompt. Nobody is handed a character on install; you go and choose one,
// or you never do and the app is exactly what it was.
function renderNaviPicker() {
  const cur = STATE.naviId;
  const card = n => `
    <button class="navi-chip ${cur === n.id ? 'active' : ''}" style="--navi: ${n.color};"
            onclick="setNavi('${cur === n.id ? '' : n.id}')" aria-pressed="${cur === n.id}">
      <img src="${n.icon}" alt="">
      <span class="navi-chip-name">${escapeHtml(n.short)}</span>
      <span class="navi-chip-role">${escapeHtml(n.role)}</span>
    </button>`;
  const active = activeNavi();
  return `
    <div class="subtle-label" style="margin:18px 0 10px;">NETNAVI</div>
    <div class="panel">
      <div style="font-size:11px; color:var(--text-dim); margin-bottom:12px;">
        One at a time. Your Navi delivers your week on the review — same numbers, their voice.
        Tap the active one again to jack out.
      </div>
      <div class="navi-grid">${NAVI_ROSTER.map(card).join('')}</div>
      ${active ? `<button class="btn btn-ghost btn-sm btn-block" style="margin-top:12px;" onclick="naviSpeak(naviGreeting())">HEAR ${escapeHtml(active.short.toUpperCase())}</button>` : ''}
    </div>`;
}

// A one-line sample so picking a Navi shows you what you picked, rather than making you wait for
// Monday to find out.
const NAVI_GREETINGS = {
  strike: [naviLine('JACKED IN, BRO!!!', 'shout'), naviLine('You and me. Every session. Let us GET IT.')],
  vitalya: [naviLine('Oh, *finally* 💅'), naviLine('Okay. What did you eat today, and when did you last stretch?')],
  digi: [naviLine('DIGIMAN.EXE ONLINE. INPUT ACCEPTED.', 'mono'), naviLine('THE OPERATOR PROVIDES INPUT. DIGIMAN.EXE PROVIDES OUTPUT. PROCEED.', 'mono')],
  wenceslas: [naviLine('Come. Sit.'), naviLine('There is much a wise ruler must know — of coin, of faith, of the world.')],
  muze: [naviLine('omigosh im SO glad youre here!! :D'), naviLine('lets make something amazing together ok?? <3')],
  clay: [naviLine('Good to see you, my friend.'), naviLine('Whatever it is — I have been there. Let us figure it out together.')],
};
function naviGreeting() {
  const n = activeNavi();
  return n ? (NAVI_GREETINGS[n.id] || []) : [];
}
