/**
 * Space Highway — scene parallax.
 *
 * The fourth AMBIENT module in the codebase (after Metalheart, Runic and Liminal), and built
 * the same way: it renders nothing and only writes `--sh-px` / `--sh-py`, which theme.css feeds
 * into a `translate3d()` on each scene plane. Every plane multiplies those offsets by its own
 * depth fraction — the far star field barely drifts, the guardrail at the roadside swings the
 * most — so one pair of numbers drives the whole road and the layers separate on their own.
 * That differential is the entire illusion; matching the rates would slide the scene as one
 * flat picture.
 *
 * The scene still renders (just still) when this module isn't loaded — no JS, a `file://` page
 * where ES modules can't be imported, or before the lazy import lands — because every
 * `translate3d()` in theme.css falls back to `0px`.
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
const MAX_SHIFT = 40;
/** How much of the remaining distance to close each frame. */
const EASE = 0.08;
/** Below this, snap and stop the loop rather than chasing forever. */
const EPSILON = 0.05;
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
function createSpaceHighwayFX() {
    let rafId = 0;
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let pointerFine = false;
    let reduceMotion = null;
    let root = null;
    function write() {
        if (!root)
            return;
        root.style.setProperty('--sh-px', curX.toFixed(2) + 'px');
        root.style.setProperty('--sh-py', curY.toFixed(2) + 'px');
    }
    function tick() {
        curX += (targetX - curX) * EASE;
        curY += (targetY - curY) * EASE;
        write();
        if (Math.abs(targetX - curX) > EPSILON || Math.abs(targetY - curY) > EPSILON) {
            rafId = requestAnimationFrame(tick);
        }
        else {
            curX = targetX;
            curY = targetY;
            write();
            rafId = 0; // arrived — stop burning frames until the target moves again
        }
    }
    function start() {
        if (rafId !== 0)
            return;
        if (reduceMotion && reduceMotion.matches)
            return;
        rafId = requestAnimationFrame(tick);
    }
    function stop() {
        if (rafId !== 0) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
    }
    /** Scroll drives the vertical component: the scene lags the page, which reads as depth. */
    function onScroll() {
        const doc = document.documentElement;
        const span = Math.max(doc.scrollHeight - window.innerHeight, 1);
        const progress = clamp(window.scrollY / span, 0, 1);
        targetY = -(progress - 0.5) * 2 * MAX_SHIFT;
        start();
    }
    /** Pointer adds a horizontal lean, but only on a real pointer — on touch this fires just
     *  during a drag, which would make the road twitch mid-scroll. */
    function onPointerMove(ev) {
        if (!pointerFine)
            return;
        const nx = (ev.clientX / Math.max(window.innerWidth, 1)) - 0.5;
        const ny = (ev.clientY / Math.max(window.innerHeight, 1)) - 0.5;
        targetX = -nx * 2 * MAX_SHIFT;
        targetY = clamp(targetY - ny * MAX_SHIFT * 0.35, -MAX_SHIFT, MAX_SHIFT);
        start();
    }
    function onVisibility() {
        if (document.hidden)
            stop();
        else
            start();
    }
    function onResize() {
        onScroll();
    }
    return {
        key: 'spacehighway',
        init(_root) {
            if (root)
                return; // idempotent
            root = document.documentElement;
            reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
            pointerFine = window.matchMedia('(pointer: fine)').matches;
            window.addEventListener('scroll', onScroll, { passive: true });
            window.addEventListener('resize', onResize);
            document.addEventListener('pointermove', onPointerMove, { passive: true });
            document.addEventListener('visibilitychange', onVisibility);
            onScroll(); // settle to wherever the page already is
        },
        destroy() {
            stop();
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onResize);
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('visibilitychange', onVisibility);
            // Clear the offsets — leaving them set would shift whatever theme comes next if it ever
            // reused these names, and it leaves inline junk on <html>.
            if (root) {
                root.style.removeProperty('--sh-px');
                root.style.removeProperty('--sh-py');
            }
            root = null;
            reduceMotion = null;
            curX = curY = targetX = targetY = 0;
        },
    };
}
export default createSpaceHighwayFX();
