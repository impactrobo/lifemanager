/**
 * Hedge — floating ring parallax.
 *
 * AMBIENT module, the same shape as aesthetics/runic/fx.ts and metalheart/fx.ts: it renders
 * nothing and only writes two CSS custom properties, `--hg-px` / `--hg-py`, which theme.css
 * feeds into the ring layer's `translate`. The ring therefore still hangs there AND STILL
 * SPINS with this module absent — no JS, a `file://` page where ES modules can't be imported,
 * or before the lazy import lands — because the spin is a CSS animation and the parallax
 * falls back to `0px`. Never make either depend on this file.
 *
 * Why `translate` and not `transform`: the ring's spin animates the `rotate` property, and the
 * two individual transform properties compose without either clobbering the other. Writing a
 * `transform: translate3d(...)` here instead would be overwritten by the animation every frame
 * (or vice versa), which is exactly the bug this split avoids.
 *
 * Travel is deliberately smaller than Runic's sword (24px vs 34px): the ring is a smaller
 * object further into the scene, and it's also SPINNING, so a large drift on top of the
 * rotation reads as wobble rather than depth.
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

/** Furthest the ring travels from centre, px. */
const MAX_SHIFT = 24;
/** How much of the remaining distance to close each frame. */
const EASE = 0.075;
/** Below this, snap and stop the loop rather than chasing forever. */
const EPSILON = 0.05;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function createHedgeFX(): AestheticFX {
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
    root.style.setProperty('--hg-px', curX.toFixed(2) + 'px');
    root.style.setProperty('--hg-py', curY.toFixed(2) + 'px');
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

  /** Scroll drives the vertical component: the ring lags the page, which reads as depth. */
  function onScroll(): void {
    const doc = document.documentElement;
    const span = Math.max(doc.scrollHeight - window.innerHeight, 1);
    const progress = clamp(window.scrollY / span, 0, 1);
    targetY = -(progress - 0.5) * 2 * MAX_SHIFT;
    start();
  }

  /** Pointer adds a horizontal lean, but only on a real pointer — on touch this fires just
   *  during a drag, which would make the ring twitch mid-scroll. */
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
    key: 'hedge',
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
        root.style.removeProperty('--hg-px');
        root.style.removeProperty('--hg-py');
      }
      root = null;
      reduceMotion = null;
      curX = curY = targetX = targetY = 0;
    },
  };
}

export default createHedgeFX();
