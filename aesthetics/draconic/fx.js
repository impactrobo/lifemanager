/**
 * Draconic — tap embers.
 *
 * Spawns a burst of rising embers wherever a "hot" control is pressed. Everything lives on one
 * fixed, pointer-events:none canvas so it can never intercept a tap or be wiped by a render
 * (`#app.innerHTML` is replaced on every render, so the canvas goes on <body> instead).
 *
 * Contract notes (see types/app.d.ts > AestheticFX):
 *  - `destroy()` must leave nothing behind. Every listener and the rAF handle are tracked and
 *    released, because the aesthetic switcher calls destroy() before init()-ing the next theme
 *    and a surviving loop would burn battery under a theme that never asked for it.
 *  - The rAF loop is demand-driven: it only runs while embers are alive, then stops. Idle cost
 *    is zero — no always-on animation frame.
 *  - Honours prefers-reduced-motion (no particles at all) and pauses on tab hide.
 *
 * Compiled to fx.js via `npm run build:fx` — the .js is committed; see tsconfig.fx.json.
 */
/** Controls that feel "hot" enough to throw embers. Deliberately not every button — this app
 *  is tapped constantly for data entry and embers everywhere would be noise plus battery. */
const TRIGGER_SELECTOR = '.btn-primary, .btn-danger, .btn-good, .subnav button.active, .workout-cell.home-tile';
const BURST_MIN = 14;
const BURST_MAX = 22;
/** Hard ceiling so a rapid tapper can't grow the array without bound. */
const MAX_EMBERS = 320;
function rand(min, max) {
    return min + Math.random() * (max - min);
}
function createDraconicFX() {
    let canvas = null;
    let ctx = null;
    let embers = [];
    let rafId = 0;
    let lastFrame = 0;
    let dpr = 1;
    let reduceMotion = null;
    function sizeCanvas() {
        if (!canvas || !ctx)
            return;
        dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2 — 3x costs a lot for embers
        canvas.width = Math.floor(window.innerWidth * dpr);
        canvas.height = Math.floor(window.innerHeight * dpr);
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function spawn(x, y) {
        const count = Math.round(rand(BURST_MIN, BURST_MAX));
        for (let i = 0; i < count; i++) {
            if (embers.length >= MAX_EMBERS)
                break;
            const maxLife = rand(650, 1350);
            embers.push({
                x: x + rand(-10, 10),
                y: y + rand(-6, 6),
                vx: rand(-0.55, 0.55),
                vy: rand(-0.16, -0.05),
                life: maxLife,
                maxLife,
                size: rand(1.4, 3.4),
                phase: rand(0, Math.PI * 2),
            });
        }
        start();
    }
    function step(now) {
        if (!ctx || !canvas)
            return;
        const dt = Math.min(now - lastFrame, 50); // clamp: a backgrounded tab can hand us a huge gap
        lastFrame = now;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Additive blending is what makes overlapping embers read as fire rather than as stacked dots.
        ctx.globalCompositeOperation = 'lighter';
        for (let i = embers.length - 1; i >= 0; i--) {
            const e = embers[i];
            e.life -= dt;
            if (e.life <= 0) {
                embers.splice(i, 1);
                continue;
            }
            // Buoyancy decays as the ember cools, so it rises fast then hangs and drifts.
            e.vy += 0.00055 * dt;
            e.vx += Math.sin(now / 220 + e.phase) * 0.00035 * dt;
            e.x += e.vx * dt * 0.35;
            e.y += e.vy * dt * 0.35;
            const t = e.life / e.maxLife; // 1 -> 0 over its life
            const alpha = t * t; // fade out fast at the end
            // Hot white-gold at birth, cooling through orange to deep red.
            const hue = 15 + 40 * t;
            const light = 45 + 35 * t;
            const r = e.size * (0.35 + 0.65 * t);
            ctx.beginPath();
            ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${hue}, 100%, ${light}%, ${alpha})`;
            ctx.fill();
            // A second, softer pass gives each ember a halo without paying for shadowBlur.
            ctx.beginPath();
            ctx.arc(e.x, e.y, r * 2.6, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${hue}, 100%, ${light}%, ${alpha * 0.13})`;
            ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        if (embers.length > 0) {
            rafId = requestAnimationFrame(step);
        }
        else {
            rafId = 0; // demand-driven: nothing alive, so stop burning frames
        }
    }
    function start() {
        if (rafId !== 0)
            return;
        lastFrame = performance.now();
        rafId = requestAnimationFrame(step);
    }
    function stop() {
        if (rafId !== 0) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
    }
    function clear() {
        embers = [];
        if (ctx && canvas)
            ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    function onPointerDown(ev) {
        if (reduceMotion && reduceMotion.matches)
            return;
        const target = ev.target;
        if (!target || typeof target.closest !== 'function')
            return;
        if (!target.closest(TRIGGER_SELECTOR))
            return;
        spawn(ev.clientX, ev.clientY);
    }
    function onVisibility() {
        if (document.hidden) {
            stop();
            clear();
        }
    }
    function onResize() {
        sizeCanvas();
    }
    return {
        key: 'draconic',
        init(root) {
            if (canvas)
                return; // idempotent
            reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
            canvas = document.createElement('canvas');
            canvas.id = 'draconicEmberCanvas';
            canvas.setAttribute('aria-hidden', 'true');
            canvas.style.cssText =
                'position:fixed;left:0;top:0;z-index:45;pointer-events:none;';
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
        destroy() {
            stop();
            embers = [];
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('resize', onResize);
            if (canvas)
                canvas.remove();
            canvas = null;
            ctx = null;
            reduceMotion = null;
        },
    };
}
export default createDraconicFX();
