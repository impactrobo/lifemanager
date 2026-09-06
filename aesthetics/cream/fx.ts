/**
 * C.R.E.A.M — tap glitter.
 *
 * A burst of gold flecks that fling out of a tapped control and then FALL, twinkling as they
 * tumble. Deliberately the inverse of Draconic's embers, which rise and cool: glitter is heavy,
 * so gravity is positive and the sparkle comes from each fleck spinning through its own
 * specular flash rather than from a colour ramp.
 *
 * Same contract and same hard rules as every AestheticFX module (see types/app.d.ts):
 *  - `destroy()` releases the rAF handle, every listener and the canvas. The switcher calls it
 *    before init()-ing the next theme, so anything left behind burns battery under a theme that
 *    never asked for it.
 *  - The rAF loop is demand-driven — it runs only while flecks are alive, then stops dead.
 *  - Honours prefers-reduced-motion and pauses on tab hide.
 *  - The canvas mounts on <body>, never #app (whose innerHTML is replaced on every render).
 *
 * Compiled to fx.js via `npm run build:fx` — the .js is committed; see tsconfig.fx.json.
 */

/** Gold controls and the gem tiles. Not every button: this app is tapped constantly for data
 *  entry, and glitter on every keystroke-adjacent tap would be noise plus battery. */
const TRIGGER_SELECTOR =
  '.btn, .icon-btn, .subnav button.active, .workout-cell.home-tile';

const BURST_MIN = 12;
const BURST_MAX = 20;
/** Hard ceiling so a rapid tapper can't grow the array without bound. */
const MAX_FLECKS = 260;

interface Fleck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** ms remaining */
  life: number;
  /** ms at spawn, for normalised fade */
  maxLife: number;
  size: number;
  /** current rotation, radians */
  rot: number;
  /** radians per ms */
  spin: number;
  /** phase offset so flecks don't all flash on the same beat */
  phase: number;
  /** twinkle frequency, radians per ms */
  freq: number;
  /** 0 = pale gold, 1 = white — fixed per fleck so the burst isn't monochrome */
  white: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** A four-point star: long axis `r`, waist `r * 0.16`. Drawn as a path so it can be rotated. */
function starPath(ctx: CanvasRenderingContext2D, r: number): void {
  const w = r * 0.16;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(w, -w, r, 0);
  ctx.quadraticCurveTo(w, w, 0, r);
  ctx.quadraticCurveTo(-w, w, -r, 0);
  ctx.quadraticCurveTo(-w, -w, 0, -r);
  ctx.closePath();
}

function createCreamFX(): AestheticFX {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let flecks: Fleck[] = [];
  let rafId = 0;
  let lastFrame = 0;
  let dpr = 1;
  let reduceMotion: MediaQueryList | null = null;

  function sizeCanvas(): void {
    if (!canvas || !ctx) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2 — 3x costs a lot for sparkles
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(x: number, y: number): void {
    const count = Math.round(rand(BURST_MIN, BURST_MAX));
    for (let i = 0; i < count; i++) {
      if (flecks.length >= MAX_FLECKS) break;
      const maxLife = rand(750, 1500);
      const angle = rand(0, Math.PI * 2);
      const speed = rand(0.08, 0.30);
      flecks.push({
        x: x + rand(-8, 8),
        y: y + rand(-6, 6),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.12, // biased upward so they arc before falling
        life: maxLife,
        maxLife,
        size: rand(2.2, 5.2),
        rot: rand(0, Math.PI * 2),
        spin: rand(-0.006, 0.006),
        phase: rand(0, Math.PI * 2),
        freq: rand(0.006, 0.013),
        white: Math.random() < 0.3 ? 1 : 0,
      });
    }
    start();
  }

  function step(now: number): void {
    if (!ctx || !canvas) return;
    const dt = Math.min(now - lastFrame, 50); // clamp: a backgrounded tab can hand us a huge gap
    lastFrame = now;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Additive blending so overlapping flecks bloom instead of stacking as opaque shapes.
    ctx.globalCompositeOperation = 'lighter';

    for (let i = flecks.length - 1; i >= 0; i--) {
      const f = flecks[i];
      f.life -= dt;
      if (f.life <= 0) {
        flecks.splice(i, 1);
        continue;
      }
      f.vy += 0.0016 * dt;   // gravity — glitter falls, unlike Draconic's rising embers
      f.vx *= 0.995;         // air drag, so the outward fling decays into a drift
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.spin * dt;

      const t = f.life / f.maxLife;               // 1 -> 0 over its life
      // Each fleck flashes on its own beat; that flicker is what reads as "glitter" rather
      // than "confetti". Squared falloff keeps them alive-looking until they abruptly go.
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(now * f.freq + f.phase));
      const alpha = t * t * twinkle;
      const r = f.size * (0.55 + 0.45 * t);
      const colour = f.white ? '255, 252, 235' : '255, 210, 90';

      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      starPath(ctx, r);
      ctx.fillStyle = `rgba(${colour}, ${alpha})`;
      ctx.fill();
      ctx.restore();

      // Soft halo, cheaper than shadowBlur and enough to sell the specular pop.
      ctx.beginPath();
      ctx.arc(f.x, f.y, r * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colour}, ${alpha * 0.16})`;
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';

    if (flecks.length > 0) {
      rafId = requestAnimationFrame(step);
    } else {
      rafId = 0; // demand-driven: nothing alive, so stop burning frames
    }
  }

  function start(): void {
    if (rafId !== 0) return;
    lastFrame = performance.now();
    rafId = requestAnimationFrame(step);
  }

  function stop(): void {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function clear(): void {
    flecks = [];
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function onPointerDown(ev: PointerEvent): void {
    if (reduceMotion && reduceMotion.matches) return;
    const target = ev.target as Element | null;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest(TRIGGER_SELECTOR)) return;
    spawn(ev.clientX, ev.clientY);
  }

  function onVisibility(): void {
    if (document.hidden) {
      stop();
      clear();
    }
  }

  function onResize(): void {
    sizeCanvas();
  }

  return {
    key: 'cream',

    init(root: HTMLElement): void {
      if (canvas) return; // idempotent
      reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

      canvas = document.createElement('canvas');
      canvas.id = 'creamGlitterCanvas';
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

      document.addEventListener('pointerdown', onPointerDown, { passive: true });
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('resize', onResize);
    },

    destroy(): void {
      stop();
      flecks = [];
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      if (canvas) canvas.remove();
      canvas = null;
      ctx = null;
      reduceMotion = null;
    },
  };
}

export default createCreamFX();
