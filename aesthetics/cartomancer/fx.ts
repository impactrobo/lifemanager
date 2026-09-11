/**
 * Cartomancer — drifting mana motes.
 *
 * A CONTINUOUS particle module: unlike Draconic's tap-triggered embers (which start empty and
 * burst-then-expire), this one is already lit the moment it loads and stays lit for as long as
 * the theme is active — a steady population of small glowing motes drifting slowly upward,
 * recycled forever rather than spawned by an interaction. This is deliberate, not an oversight:
 * the lesson from C.R.E.A.M.'s removed tap-glitter and Millennium Disco's trimmed marquee is that
 * motion tied to taps/constant interaction gets old fast on a data-entry app, so "Particle FX" for
 * this theme means ambient atmosphere, not a reward for pressing buttons.
 *
 * This needed a THIRD fx-module shape in the test suite (tests/test_aesthetic_fx.js) —
 * checkParticleModule() asserts the canvas starts empty and returns to empty; neither is true
 * here. See checkContinuousParticleModule() there, detected generically (canvas already has lit
 * pixels before any interaction) rather than by aesthetic name.
 *
 * Color comes from `--accent` on <html>, re-read periodically (not every frame — one
 * getComputedStyle call per ~500ms is plenty) rather than cached once at init(), because
 * switching the MANA COLOR palette (Protection/Control/Death/Rapidity/Growth) does NOT reload
 * this module — setAccentColor() only re-applies the CSS custom properties, so newly spawned
 * motes need to pick the new color up live.
 *
 * Contract notes (see types/app.d.ts > AestheticFX):
 *  - `destroy()` releases the rAF handle, the canvas, and every listener.
 *  - Honours prefers-reduced-motion: never starts, draws nothing (same as Draconic).
 *  - Pauses on `document.hidden` and resumes on return, rather than continuing to draw an
 *    invisible tab.
 *
 * Compiled to fx.js via `npm run build:fx` — the .js is committed; see tsconfig.fx.json.
 */

/** How many motes drift at once. Low on purpose — this runs forever, not for a few seconds like
 *  a tap burst, so per-frame cost has to stay cheap indefinitely. */
const MOTE_COUNT = 20;
/** How often (ms) to re-read --accent from the DOM, rather than every frame. */
const COLOR_REFRESH_MS = 500;

interface Mote {
  x: number;
  y: number;
  vy: number;
  swayAmp: number;
  swayFreq: number;
  phase: number;
  size: number;
  /** ms remaining before this mote fades out and respawns at the bottom. */
  life: number;
  maxLife: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** '#rrggbb' -> [r,g,b]. Falls back to a warm gold if the value can't be parsed (e.g. --accent
 *  briefly unset during a theme switch) so a mote never silently draws as black. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || '').trim());
  if (!m) return [232, 197, 66];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function createCartomancerFX(): AestheticFX {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let motes: Mote[] = [];
  let rafId = 0;
  let lastFrame = 0;
  let dpr = 1;
  let reduceMotion: MediaQueryList | null = null;
  let color: [number, number, number] = [232, 197, 66];
  let colorAge = Infinity; // forces a read on the very first frame

  function sizeCanvas(): void {
    if (!canvas || !ctx) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawnMote(startBelowFold: boolean): Mote {
    const maxLife = rand(9000, 16000);
    return {
      x: rand(0, window.innerWidth),
      y: startBelowFold ? window.innerHeight + rand(10, 80) : rand(0, window.innerHeight),
      vy: -rand(0.006, 0.016),
      swayAmp: rand(6, 22),
      swayFreq: rand(0.0004, 0.0011),
      phase: rand(0, Math.PI * 2),
      size: rand(1.2, 3),
      life: maxLife,
      maxLife,
    };
  }

  function refreshColorIfStale(dt: number): void {
    colorAge += dt;
    if (colorAge < COLOR_REFRESH_MS) return;
    colorAge = 0;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent');
    color = hexToRgb(raw);
  }

  function step(now: number): void {
    if (!ctx || !canvas) return;
    const dt = Math.min(now - lastFrame, 50); // clamp: a backgrounded tab can hand us a huge gap
    lastFrame = now;
    refreshColorIfStale(dt);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    const [r, g, b] = color;

    for (const m of motes) {
      m.life -= dt;
      m.y += m.vy * dt;
      const sway = Math.sin(now * m.swayFreq + m.phase) * m.swayAmp;
      const drawX = m.x + sway;

      // Fade in over the first tenth of life, fade out over the last quarter — a mote never
      // just pops in or out mid-frame.
      const t = m.life / m.maxLife;
      let alpha = 1;
      if (t > 0.9) alpha = (1 - t) / 0.1;
      else if (t < 0.25) alpha = t / 0.25;
      alpha *= 0.55; // motes are a background detail, never competing with foreground text

      if (m.life <= 0 || m.y < -20) {
        Object.assign(m, spawnMote(true));
        continue; // don't draw a mote the same frame it respawns
      }

      ctx.beginPath();
      ctx.arc(drawX, m.y, m.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fill();
      // A soft halo, same two-pass trick Draconic's embers use instead of paying for shadowBlur.
      ctx.beginPath();
      ctx.arc(drawX, m.y, m.size * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.14})`;
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    rafId = requestAnimationFrame(step);
  }

  function start(): void {
    if (rafId !== 0) return;
    if (reduceMotion && reduceMotion.matches) return; // no particles at all, same as Draconic
    lastFrame = performance.now();
    rafId = requestAnimationFrame(step);
  }

  function stop(): void {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function onVisibility(): void {
    if (document.hidden) stop();
    else start();
  }

  function onResize(): void {
    sizeCanvas();
  }

  return {
    key: 'cartomancer',

    init(root: HTMLElement): void {
      if (canvas) return; // idempotent
      reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

      canvas = document.createElement('canvas');
      canvas.id = 'cartomancerMoteCanvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:45;pointer-events:none;';
      root.appendChild(canvas);

      ctx = canvas.getContext('2d');
      if (!ctx) { // canvas unavailable — bail cleanly rather than half-installed
        canvas.remove();
        canvas = null;
        return;
      }
      sizeCanvas();

      motes = reduceMotion.matches ? [] : Array.from({ length: MOTE_COUNT }, () => spawnMote(false));

      window.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', onVisibility);
      start();
    },

    destroy(): void {
      stop();
      motes = [];
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (canvas) canvas.remove();
      canvas = null;
      ctx = null;
      reduceMotion = null;
      colorAge = Infinity;
    },
  };
}

export default createCartomancerFX();
