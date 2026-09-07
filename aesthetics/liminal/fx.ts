/**
 * Liminal — doorway parallax.
 *
 * The third AMBIENT module in the codebase (after Metalheart and Runic), and built the same
 * way: it renders nothing and only writes `--lm-px` / `--lm-py`, which theme.css feeds into a
 * `translate3d()` on each of the four wall planes. Every plane multiplies those offsets by its
 * own depth fraction, so one pair of numbers drives the whole corridor and the planes separate
 * on their own — the nearest doorway swings furthest, the far room barely moves. That
 * differential is the entire illusion; without it the frames would slide as one flat picture.
 *
 * The walls still render (just still) when this module isn't loaded at all — no JS, a `file://`
 * page where ES modules can't be imported, or before the lazy import lands — because every
 * translate3d() falls back to 0px.
 *
 * MAX_SHIFT is the largest in the codebase (44px against Runic's 34 and Metalheart's 22): the
 * brief asked for a strong effect, and the nearest plane is very close to the viewer, so it has
 * the furthest to travel. The far room, at 0.12 of that, moves about 5px.
 *
 * Input is scroll first, pointer second, and deliberately NOT device orientation: iOS gates
 * `deviceorientation` behind a permission prompt that has to be triggered by a user gesture,
 * and putting a motion-access prompt in front of someone for a background decoration is a bad
 * trade. Scroll needs no permission and is the gesture a phone user is making anyway.
 *
 * Contract notes (see types/app.d.ts > AestheticFX):
 *  - `destroy()` releases the rAF handle and every listener, and clears both properties so the
 *    next theme can't inherit an offset.
 *  - The rAF loop is demand-driven: it runs only while the eased value is still travelling
 *    toward its target, then stops. Idle cost is zero.
 *  - Honours prefers-reduced-motion (never moves) and pauses on tab hide.
 *
 * Compiled to fx.js via `npm run build:fx` — the .js is committed; see tsconfig.fx.json.
 */

/** Furthest the nearest plane travels from centre, px. Every other plane is a fraction of it. */
const MAX_SHIFT = 44;
/** How much of the remaining distance to close each frame. */
const EASE = 0.075;
/** Below this, snap and stop the loop rather than chasing forever. */
const EPSILON = 0.05;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function createLiminalFX(): AestheticFX {
  let rafId = 0;
  let targetX = 0;
  let targetY = 0;
  let curX = 0;
  let curY = 0;
  let pointerFine = false;
  let reduceMotion: MediaQueryList | null = null;
  let root: HTMLElement | null = null;

  function write(): void {
    if (!root) return;
    root.style.setProperty('--lm-px', curX.toFixed(2) + 'px');
    root.style.setProperty('--lm-py', curY.toFixed(2) + 'px');
  }

  function tick(): void {
    curX += (targetX - curX) * EASE;
    curY += (targetY - curY) * EASE;
    write();
    if (Math.abs(targetX - curX) > EPSILON || Math.abs(targetY - curY) > EPSILON) {
      rafId = requestAnimationFrame(tick);
    } else {
      curX = targetX;
      curY = targetY;
      write();
      rafId = 0; // arrived — stop burning frames until the target moves again
    }
  }

  function start(): void {
    if (rafId !== 0) return;
    if (reduceMotion && reduceMotion.matches) return;
    rafId = requestAnimationFrame(tick);
  }

  function stop(): void {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  /** Scroll drives the vertical component: the corridor lags the page, which reads as depth. */
  function onScroll(): void {
    const doc = document.documentElement;
    const span = Math.max(doc.scrollHeight - window.innerHeight, 1);
    const progress = clamp(window.scrollY / span, 0, 1);
    targetY = -(progress - 0.5) * 2 * MAX_SHIFT;
    start();
  }

  /** Pointer adds a horizontal lean, but only on a real pointer — on touch this fires just
   *  during a drag, which would make the corridor twitch mid-scroll. */
  function onPointerMove(ev: PointerEvent): void {
    if (!pointerFine) return;
    const nx = (ev.clientX / Math.max(window.innerWidth, 1)) - 0.5;
    const ny = (ev.clientY / Math.max(window.innerHeight, 1)) - 0.5;
    targetX = -nx * 2 * MAX_SHIFT;
    targetY = clamp(targetY - ny * MAX_SHIFT * 0.35, -MAX_SHIFT, MAX_SHIFT);
    start();
  }

  function onVisibility(): void {
    if (document.hidden) stop();
    else start();
  }

  function onResize(): void {
    onScroll();
  }

  return {
    key: 'liminal',
    init(_root: HTMLElement): void {
      if (root) return; // idempotent
      root = document.documentElement;
      reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      pointerFine = window.matchMedia('(pointer: fine)').matches;
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize);
      document.addEventListener('pointermove', onPointerMove, { passive: true });
      document.addEventListener('visibilitychange', onVisibility);
      onScroll(); // settle to wherever the page already is
    },
    destroy(): void {
      stop();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
      // Clear the offsets — leaving them set would shift whatever theme comes next if it ever
      // reused these names, and it leaves inline junk on <html>.
      if (root) {
        root.style.removeProperty('--lm-px');
        root.style.removeProperty('--lm-py');
      }
      root = null;
      reduceMotion = null;
      curX = curY = targetX = targetY = 0;
    },
  };
}

export default createLiminalFX();
