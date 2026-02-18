/**
 * Canvas-based loading animation.
 * A miniature, animated echo of the main renderer's visual phases:
 * pulsing glows, orbiting attractor nodes, rotating polygon shards, vignette.
 *
 * Smoothness techniques:
 *   - Lissajous curves for organic, non-repetitive orbits
 *   - Multi-harmonic sine blends for breathing / pulsing
 *   - Soft multi-stop radial gradients
 *   - Slow, unhurried motion throughout
 *   - Emerge-from-point / condense-to-point transitions
 *
 * Usage:
 *   import { createLoadingAnimation } from './loading-animation.js';
 *   const loader = createLoadingAnimation(containerEl);
 *   loader.start();   // emerge from center, begin loop
 *   loader.stop();    // condense to center, then remove
 */

export function createLoadingAnimation(containerEl) {

    let canvas = null;
    let ctx = null;
    let rafId = null;
    let startTime = 0;

    /* ── Transition state machine ── */
    const EMERGE_MS  = 1000;
    const CONDENSE_MS = 600;

    // phase: 'idle' | 'emerging' | 'running' | 'condensing'
    let phase = 'idle';
    let scale = 0;               // 0 = singularity, 1 = full bloom
    let transitionStart = 0;     // timestamp of current transition
    let transitionFrom = 0;      // scale at transition start (for reversals)

    /* ── Easing ── */
    function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
    function easeInCubic(x)  { return x * x * x; }

    function updateScale(timestamp) {
        if (phase === 'emerging') {
            const elapsed = timestamp - transitionStart;
            const t = Math.min(elapsed / EMERGE_MS, 1);
            scale = transitionFrom + (1 - transitionFrom) * easeOutCubic(t);
            if (t >= 1) phase = 'running';
        } else if (phase === 'condensing') {
            const elapsed = timestamp - transitionStart;
            const t = Math.min(elapsed / CONDENSE_MS, 1);
            scale = transitionFrom * (1 - easeInCubic(t));
            if (t >= 1) {
                phase = 'idle';
                scale = 0;
                cancelAnimationFrame(rafId);
                rafId = null;
                if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
                return false; // signal: stop drawing
            }
        }
        return true; // keep drawing
    }

    /* ── Theme colour cache (re-read on each start) ── */
    let accentR = 130, accentG = 200, accentB = 255;
    let bgR = 11, bgG = 13, bgB = 18;

    function readThemeColors() {
        const s = getComputedStyle(document.documentElement);
        const bgRaw = s.getPropertyValue('--bg').trim() || '#0b0d12';
        const hm = bgRaw.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
        if (hm) { bgR = parseInt(hm[1], 16); bgG = parseInt(hm[2], 16); bgB = parseInt(hm[3], 16); }

        const raw = s.getPropertyValue('--accent-text').trim();
        const m = raw.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) { accentR = +m[1]; accentG = +m[2]; accentB = +m[3]; }
    }

    function accent(a) { return `rgba(${accentR},${accentG},${accentB},${a})`; }

    /* ── Smooth breathing (multi-harmonic sine, no hard peaks) ── */
    function smoothBreath(t, speed) {
        return (
            Math.sin(t * speed) * 0.6 +
            Math.sin(t * speed * 1.73 + 0.9) * 0.25 +
            Math.sin(t * speed * 0.51 + 2.1) * 0.15
        );
    }

    /* ── Phase A: pulsing radial glows ── */
    const GLOWS = [
        { ox: -0.12, oy: -0.07, baseR: 0.40, pulse: 0.08, speed: 0.35, alpha: 0.055 },
        { ox:  0.09, oy:  0.06, baseR: 0.32, pulse: 0.06, speed: 0.48, alpha: 0.045 },
        { ox:  0.00, oy:  0.00, baseR: 0.48, pulse: 0.10, speed: 0.25, alpha: 0.040 },
    ];

    function drawGlows(w, h, t, s) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const cx = w * 0.5, cy = h * 0.5;
        const dim = Math.min(w, h);
        for (const g of GLOWS) {
            const drift = smoothBreath(t, g.speed * 0.3) * 0.02 * s;
            const x = cx + (g.ox * s + drift) * w;
            const y = cy + (g.oy * s + drift * 0.7) * h;
            const r = Math.max(1, (g.baseR * s + smoothBreath(t, g.speed) * g.pulse * s) * dim);
            const a = g.alpha * s * (0.85 + smoothBreath(t, g.speed * 0.7) * 0.15);

            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0.0, accent(a));
            grad.addColorStop(0.3, accent(a * 0.6));
            grad.addColorStop(0.7, accent(a * 0.15));
            grad.addColorStop(1.0, accent(0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    /* ── Phase B: orbiting attractor nodes (Lissajous curves) ── */
    const NODES = [
        { ax: 0.20, ay: 0.16, fx: 0.31, fy: 0.23, px: 0.00, py: 0.40, r: 2.8 },
        { ax: 0.26, ay: 0.12, fx: 0.24, fy: 0.37, px: 1.26, py: 0.80, r: 2.2 },
        { ax: 0.14, ay: 0.21, fx: 0.38, fy: 0.19, px: 2.51, py: 1.60, r: 3.2 },
        { ax: 0.30, ay: 0.18, fx: 0.20, fy: 0.31, px: 3.77, py: 2.20, r: 1.9 },
        { ax: 0.18, ay: 0.26, fx: 0.29, fy: 0.22, px: 5.03, py: 3.10, r: 2.5 },
    ];

    function drawNodes(w, h, t, s) {
        ctx.save();
        const cx = w * 0.5, cy = h * 0.5;
        const dim = Math.min(w, h);
        for (const n of NODES) {
            const x = cx + Math.sin(t * n.fx + n.px) * n.ax * dim * s;
            const y = cy + Math.sin(t * n.fy + n.py) * n.ay * dim * s;

            // Soft glow
            ctx.globalCompositeOperation = 'screen';
            const gr = Math.max(1, n.r * 8 * s);
            const glowAlpha = (0.09 + smoothBreath(t, 0.4 + n.fx * 0.3) * 0.03) * s;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, gr);
            grad.addColorStop(0.0, accent(glowAlpha));
            grad.addColorStop(0.35, accent(glowAlpha * 0.45));
            grad.addColorStop(0.75, accent(glowAlpha * 0.08));
            grad.addColorStop(1.0, accent(0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, gr, 0, Math.PI * 2);
            ctx.fill();

            // Node dot
            ctx.globalCompositeOperation = 'source-over';
            const dotR = Math.max(0.3, n.r * s * (1 + smoothBreath(t, 0.5) * 0.12));
            const dg = ctx.createRadialGradient(x, y, 0, x, y, dotR * 1.8);
            dg.addColorStop(0.0, accent(0.8 * s));
            dg.addColorStop(0.5, accent(0.35 * s));
            dg.addColorStop(1.0, accent(0));
            ctx.fillStyle = dg;
            ctx.beginPath();
            ctx.arc(x, y, dotR * 1.8, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    /* ── Phase C: rotating polygon shards ── */
    const SHARDS = [
        { sides: 5, orbitAx: 0.13, orbitAy: 0.10, fx: 0.14, fy: 0.11, rotSpeed:  0.08, size: 0.09, px: 0.0, py: 0.5 },
        { sides: 6, orbitAx: 0.18, orbitAy: 0.14, fx: 0.10, fy: 0.15, rotSpeed: -0.10, size: 0.12, px: 2.1, py: 1.3 },
        { sides: 4, orbitAx: 0.08, orbitAy: 0.12, fx: 0.18, fy: 0.09, rotSpeed:  0.12, size: 0.07, px: 4.2, py: 2.7 },
    ];

    function drawShards(w, h, t, s) {
        ctx.save();
        const cx = w * 0.5, cy = h * 0.5;
        const dim = Math.min(w, h);
        for (let i = 0; i < SHARDS.length; i++) {
            const sh = SHARDS[i];
            const sx = cx + Math.sin(t * sh.fx + sh.px) * sh.orbitAx * dim * s;
            const sy = cy + Math.sin(t * sh.fy + sh.py) * sh.orbitAy * dim * s;
            const rot = t * sh.rotSpeed;
            const radius = Math.max(0.5, sh.size * dim * s);
            const wobble = (0.08 + 0.03 * smoothBreath(t, 0.6 + i * 0.15)) * s;
            const fillAlpha = (0.035 + smoothBreath(t, 0.3 + i * 0.1) * 0.015) * s;
            const strokeAlpha = (0.06 + smoothBreath(t, 0.35 + i * 0.12) * 0.02) * s;

            ctx.globalCompositeOperation = i % 2 === 0 ? 'lighter' : 'screen';
            ctx.fillStyle = accent(fillAlpha);
            ctx.strokeStyle = accent(strokeAlpha);
            ctx.lineWidth = 0.8;
            ctx.lineJoin = 'round';

            ctx.beginPath();
            for (let v = 0; v < sh.sides; v++) {
                const a = rot + (v / sh.sides) * Math.PI * 2;
                const wf = 1 + Math.sin(a * 2 + t * 0.25) * wobble;
                const px = sx + Math.cos(a) * radius * wf;
                const py = sy + Math.sin(a) * radius * wf;
                if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    /* ── Phase D: vignette ── */
    function drawVignette(w, h) {
        const cx = w * 0.5, cy = h * 0.5;
        const r = Math.min(w, h) * 0.65;
        const grad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
        grad.addColorStop(0.0, 'rgba(0,0,0,0)');
        grad.addColorStop(0.6, 'rgba(0,0,0,0.08)');
        grad.addColorStop(1.0, 'rgba(0,0,0,0.42)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }

    /* ── Frame loop ── */
    function drawFrame(timestamp) {
        if (phase === 'idle') return;

        if (!updateScale(timestamp)) return; // condensing finished

        const t = (timestamp - startTime) / 1000;
        const w = canvas.width, h = canvas.height;

        // Full opaque clear — no trail artifacts
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgb(${bgR},${bgG},${bgB})`;
        ctx.fillRect(0, 0, w, h);

        drawGlows(w, h, t, scale);
        drawNodes(w, h, t, scale);
        drawShards(w, h, t, scale);
        drawVignette(w, h);

        rafId = requestAnimationFrame(drawFrame);
    }

    /* ── Public API ── */
    function start() {
        readThemeColors();

        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.className = 'loading-canvas';
            ctx = canvas.getContext('2d');
        }

        const rect = containerEl.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width  = Math.round(rect.width  * dpr);
        canvas.height = Math.round(rect.height * dpr);

        if (!canvas.parentNode) containerEl.appendChild(canvas);

        const now = performance.now();

        if (phase === 'condensing') {
            // Reverse mid-condense → emerge from current scale
            transitionFrom = scale;
            transitionStart = now;
            phase = 'emerging';
            // rAF loop is already running
        } else if (phase === 'idle' || phase === 'running') {
            transitionFrom = scale; // usually 0
            transitionStart = now;
            startTime = now;
            phase = 'emerging';
            rafId = requestAnimationFrame(drawFrame);
        }
        // if already emerging, no-op
    }

    function stop() {
        if (phase === 'idle') return;
        if (phase === 'emerging' || phase === 'running') {
            transitionFrom = scale;
            transitionStart = performance.now();
            phase = 'condensing';
            // rAF loop keeps running until condense finishes
        }
        // if already condensing, let it finish
    }

    function isRunning() { return phase !== 'idle'; }

    return { start, stop, isRunning };
}
