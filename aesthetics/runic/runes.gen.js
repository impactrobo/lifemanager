// runes.gen.js — regenerates the four rune-field SVGs for the Runic aesthetic.
//
// Run it with:  node aesthetics/runic/runes.gen.js
//
// NOT shipped code and never loaded by the app — it's a developer tool that lives next to its
// output, the same way fx.ts lives next to the fx.js it compiles to. It exists because
// runes-carved.svg and runes-a/b/c.svg have to agree glyph-for-glyph: the carved file draws all
// 22, and a/b/c each draw a third of the SAME glyphs at the SAME coordinates so a lit rune lands
// exactly on its own carving. Maintaining that by hand across four files drifts immediately, and
// the drift shows up as double-vision on the wall. Change the layout here and re-run; don't edit
// the SVGs.
const fs = require('fs');
const path = require('path');
const OUT = __dirname;

// Elder Futhark, drawn as stave strokes in a 40 x 60 box (see the chart: every glyph is
// straight lines, so they're all plain <path> polylines — no curves anywhere in the alphabet).
const RUNES = {
  fehu:      'M8,0 V60 M8,10 L26,2 M8,26 L26,18',
  uruz:      'M8,60 V4 L26,16 V60',
  thurisaz:  'M8,0 V60 M8,14 L22,24 L8,34',
  ansuz:     'M8,0 V60 M8,8 L24,16 M8,24 L24,32',
  raido:     'M8,0 V60 M8,2 L24,12 L8,24 M8,24 L26,58',
  kaunan:    'M22,4 L8,30 L22,56',
  gebo:      'M4,4 L32,56 M32,4 L4,56',
  wunjo:     'M8,0 V60 M8,4 L26,16 L8,28',
  hagalaz:   'M6,0 V60 M30,0 V60 M6,22 L30,38',
  naudiz:    'M14,0 V60 M2,38 L28,20',
  isaz:      'M14,0 V60',
  jera:      'M6,8 L18,18 L6,28 M30,32 L18,42 L30,52',
  algiz:     'M14,60 V16 M14,16 L2,2 M14,16 L26,2',
  sowilo:    'M26,2 L10,18 L26,34 L10,50',
  tiwaz:     'M14,60 V10 M2,22 L14,8 L26,22',
  berkanan:  'M8,0 V60 M8,4 L24,14 L8,24 M8,28 L24,40 L8,52',
  ehwaz:     'M6,60 V6 M30,60 V6 M6,6 L18,20 L30,6',
  mannaz:    'M6,0 V60 M30,0 V60 M6,6 L30,26 M30,6 L6,26',
  laguz:     'M10,0 V60 M10,6 L26,20',
  ingwaz:    'M18,4 L30,26 L18,48 L6,26 Z',
  dagaz:     'M6,4 V56 M30,4 V56 M6,4 L30,56 M6,56 L30,4',
  othala:    'M18,2 L30,18 L18,34 L6,18 Z M12,30 L4,58 M24,30 L32,58',
};

// 640, not 480. At 480 the glyphs came out ~60px tall on a 390px viewport (wall-sized
// graffiti); dropping the render size to 280 fixed the scale but packed ~90 runes on screen and
// the tile visibly repeated three times down the page. The fix is a BIGGER tile with SMALLER
// glyphs: same 22 placements spread over 640px at 0.58 scale gives ~18 runes on a phone screen
// with the repeat barely reaching twice. theme.css must render this at its natural 640px --
// the carved layer and the ignite layer both.
const TILE = 640;
const SPREAD = 640 / 480;   // the placements below were authored on a 480 grid
const SHRINK = 0.58;
// x, y, scale, rune, group. Groups 0/1/2 are the three ignite phases — deliberately
// interleaved across the tile so the wall reads as scattered runes waking one after another
// rather than as three blocks taking turns. Kept clear of the tile edges so a glyph is never
// sliced in half by the repeat.
const PLACED = [
  { x:  38, y:  26, s: 1.00, r: 'algiz',    g: 0 },
  { x: 168, y:  62, s: 0.78, r: 'isaz',     g: 1 },
  { x: 262, y:  18, s: 0.92, r: 'gebo',     g: 2 },
  { x: 372, y:  74, s: 1.05, r: 'thurisaz', g: 0 },
  { x:  92, y: 146, s: 0.85, r: 'sowilo',   g: 2 },
  { x: 226, y: 130, s: 1.10, r: 'ingwaz',   g: 1 },
  { x: 348, y: 190, s: 0.80, r: 'kaunan',   g: 2 },
  { x:  24, y: 232, s: 0.95, r: 'raido',    g: 1 },
  { x: 148, y: 254, s: 1.00, r: 'dagaz',    g: 0 },
  { x: 288, y: 288, s: 0.88, r: 'naudiz',   g: 2 },
  { x: 396, y: 306, s: 1.02, r: 'tiwaz',    g: 1 },
  { x:  62, y: 348, s: 0.90, r: 'berkanan', g: 2 },
  { x: 196, y: 372, s: 1.06, r: 'othala',   g: 0 },
  { x: 320, y: 404, s: 0.82, r: 'jera',     g: 1 },
  { x: 424, y: 412, s: 0.94, r: 'ehwaz',    g: 0 },
  { x: 118, y:  50, s: 0.72, r: 'wunjo',    g: 2 },
  { x: 300, y: 108, s: 0.76, r: 'laguz',    g: 0 },
  { x:  10, y: 118, s: 0.84, r: 'hagalaz',  g: 1 },
  { x: 244, y: 210, s: 0.74, r: 'ansuz',    g: 0 },
  { x: 130, y: 316, s: 0.86, r: 'mannaz',   g: 1 },
  { x: 404, y: 246, s: 0.78, r: 'uruz',     g: 2 },
  { x: 232, y: 430, s: 0.80, r: 'fehu',     g: 2 },
];

const HEADER = (what) => `<!--
  Runic — ${what}

  GENERATED AS A SET. runes-carved.svg and runes-a/b/c.svg all come from one coordinate
  table and MUST stay in lockstep: the carved file draws every glyph, and a/b/c each draw a
  third of the same glyphs at identical positions so the lit ones land exactly on their own
  carving. Edit one by hand and you get double-vision where they disagree.

  The three lit files are the ignite phases. theme.css cross-fades between them on one
  element by animating opacity and swapping background-image during the dark beat, which is
  why they are separate files rather than groups inside one document — CSS background-image
  can't address a group.

  Glyphs are Elder Futhark, decorative rather than spelling anything. Every rune in the
  alphabet is built from straight staves, so these are all plain polyline paths.
-->`;

function glyphs(filter) {
  return PLACED.filter(filter).map(p => {
    const d = RUNES[p.r];
    if (!d) throw new Error('unknown rune ' + p.r);
    const x = +(p.x * SPREAD).toFixed(1), y = +(p.y * SPREAD).toFixed(1);
    return `  <g transform="translate(${x},${y}) scale(${(p.s * SHRINK).toFixed(3)})"><path d="${d}"/></g>`;
  }).join('\n');
}

function write(name, what, body) {
  const f = path.join(OUT, name);
  fs.writeFileSync(f, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}" width="${TILE}" height="${TILE}">
${HEADER(what)}
${body}
</svg>
`);
  console.log('wrote', name);
}

// Carved: chiselled into the stone. A dark stroke with a lighter one offset down-right is the
// same trick the Metalheart cables use for tubes — here it reads as a cut edge catching light.
write('runes-carved.svg', 'all glyphs, chiselled unlit into the stone.',
`<g fill="none" stroke-linecap="round" stroke-linejoin="round">
  <g stroke="#0a0c0d" stroke-width="9" opacity="0.7">
${glyphs(() => true)}
  </g>
  <g stroke="#6d7a80" stroke-width="3" opacity="0.42" transform="translate(2,2.6)">
${glyphs(() => true)}
  </g>
</g>`);

// Lit: the glow is a wide soft stroke under a bright core.
for (const [i, letter] of ['a', 'b', 'c'].entries()) {
  write(`runes-${letter}.svg`, `ignite phase ${letter.toUpperCase()} — one third of the glyphs, lit.`,
`<defs>
  <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="6"/>
  </filter>
</defs>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
  <g stroke="#2fe08a" stroke-width="9" opacity="0.55" filter="url(#glow)">
${glyphs(p => p.g === i)}
  </g>
  <g stroke="#8dffc4" stroke-width="4">
${glyphs(p => p.g === i)}
  </g>
</g>`);
}
