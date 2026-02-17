/**
 * Canvas renderer factory.
 * Returns { renderWith } bound to a specific canvas/context pair.
 * renderWith is pure output — it draws to the canvas and returns metadata,
 * but does NOT touch the DOM (title/alt text updates are the caller's job).
 *
 * Each visual phase uses an independent sub-RNG seeded from the base seed.
 * This prevents count changes (e.g. nodeCount stepping from 7 to 8) from
 * cascading downstream and reshuffling the entire visual structure.
 * Fractional count blending fades the boundary element in/out smoothly.
 */

import { clamp01, lerp, xmur3, mulberry32 } from './prng.js';
import { deriveParams } from './params.js';
import { generateTitle, generateAltText } from './text.js';

export function createRenderer(canvas, ctx) {

    function hsl(h, s, l, a = 1) {
        return `hsla(${h}, ${s}%, ${l}%, ${a})`;
    }

    function clearBg(bg) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    function vignette(alpha = 0.55) {
        const w = canvas.width, h = canvas.height;
        const g = ctx.createRadialGradient(
            w * 0.5, h * 0.52, Math.min(w, h) * 0.12,
            w * 0.5, h * 0.52, Math.min(w, h) * 0.62
        );
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(0,0,0,${alpha})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }

    function softGlow(x, y, r, a) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    function addGrain(rng, amount = 0.05) {
        const W = canvas.width, H = canvas.height;
        const img = ctx.getImageData(0, 0, W, H);
        const d = img.data;
        const a = amount * 255;
        for (let i = 0; i < d.length; i += 4) {
            const n = (rng() * 2 - 1) * a;
            d[i] = Math.max(0, Math.min(255, d[i] + n));
            d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
            d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
        }
        ctx.putImageData(img, 0, 0);
    }

    function signedNoise2D(x, y) {
        return (
            Math.sin(x * 0.012 + 10.0) +
            Math.sin(y * 0.015 - 4.0) +
            Math.sin((x + y) * 0.008 + 2.7)
        ) / 3.0;
    }

    function drawShard(x, y, radius, sides, angle0, rng, p) {
        const wobbleBase = lerp(0.22, 0.10, p.edgeSharpness) + p.fracture * 0.12;
        const wobble = wobbleBase * (1 + 0.25 * p.bleed);

        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const t = i / sides;
            const ang = angle0 + t * Math.PI * 2;
            const w = 1 + (rng() * 2 - 1) * wobble;
            const rr = radius * w * (0.92 + 0.16 * Math.sin(ang * 2 + rng() * 2));
            const px = x + Math.cos(ang) * rr;
            const py = y + Math.sin(ang) * rr;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = lerp(0.6, 1.6, 1 - p.edgeSharpness) * (0.7 + 0.6 * rng());
        ctx.stroke();
    }

    /**
     * Render a frame given a seed string and aspect values.
     * @returns {{ title: string, altText: string, nodeCount: number, derived: object }}
     */
    function renderWith(seedStr, aspects) {
        // Independent sub-RNGs per visual phase
        const seedFn  = xmur3(seedStr);
        const baseRng = mulberry32(seedFn());
        const paramsRng = mulberry32(Math.floor(baseRng() * 0x100000000));
        const titleRng  = mulberry32(Math.floor(baseRng() * 0x100000000));
        const glowRng   = mulberry32(Math.floor(baseRng() * 0x100000000));
        const nodeRng   = mulberry32(Math.floor(baseRng() * 0x100000000));
        const shardRng  = mulberry32(Math.floor(baseRng() * 0x100000000));
        const flowRng   = mulberry32(Math.floor(baseRng() * 0x100000000));
        const grainRng  = mulberry32(Math.floor(baseRng() * 0x100000000));

        const p = deriveParams(aspects, paramsRng);
        const title = generateTitle(aspects, titleRng);

        const W = canvas.width, H = canvas.height;
        const cx = W * 0.5, cy = H * 0.52;

        const bg = hsl(p.hue, 35, lerp(5, 12, p.lum), 1);
        clearBg(bg);

        // Field glow — fractional count blending
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const glowCountF = 5 + lerp(1, 8, aspects.radiance);
        const glowFloor = Math.floor(glowCountF);
        const glowFrac = glowCountF - glowFloor;
        for (let i = 0; i <= glowFloor; i++) {
            const isLast = i === glowFloor;
            const x = lerp(W * 0.20, W * 0.80, glowRng());
            const y = lerp(H * 0.22, H * 0.78, glowRng());
            const r = lerp(220, 560, glowRng()) * lerp(0.7, 1.1, aspects.radiance);
            const alpha = lerp(0.02, 0.10, aspects.radiance) * (0.65 + 0.7 * glowRng());
            softGlow(x, y, r, isLast ? alpha * glowFrac : alpha);
        }
        ctx.restore();

        // Nodes — fractional count, last node gets weight for glow/attraction
        const nodes = [];
        const nodeFloor = p.nodeCount;
        const nodeFrac = p.nodeCountF - nodeFloor;
        for (let i = 0; i <= nodeFloor; i++) {
            const isLast = i === nodeFloor;
            const r = lerp(10, 28, nodeRng());
            const x = lerp(W * 0.20, W * 0.80, nodeRng());
            const y = lerp(H * 0.22, H * 0.82, nodeRng());
            nodes.push({ x, y, r, weight: isLast ? nodeFrac : 1 });
        }

        // Symmetry axis hint
        const axisAlpha = lerp(0.00, 0.08, p.symmetry) * (1 - 0.35 * p.fracture);
        if (axisAlpha > 0.001) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.strokeStyle = `rgba(255,255,255,${axisAlpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, H * 0.10);
            ctx.lineTo(cx, H * 0.92);
            ctx.stroke();
            ctx.restore();
        }

        function mirrorX(x, rng) {
            const dx = x - cx;
            const perfect = cx - dx;
            const fractured = perfect + (rng() * 2 - 1) * (p.fracture * 95);
            const axisSkew = (rng() * 2 - 1) * (p.multiAxis * 60);
            return lerp(fractured + axisSkew, perfect, p.symmetry);
        }

        // Shards — fractional layer and shard count blending
        const shardFloor = p.shardLayers;
        const shardLayerFrac = p.shardLayersF - shardFloor;
        const spsFloor = p.shardsPerLayer;
        const spsFrac = p.shardsPerLayerF - spsFloor;

        for (let layer = 0; layer <= shardFloor; layer++) {
            const isLastLayer = layer === shardFloor;
            const layerScale = isLastLayer ? shardLayerFrac : 1;

            const shardHue = (p.hue + lerp(-35, 75, shardRng()) + layer * lerp(8, 18, shardRng())) % 360;
            const sat = lerp(35, 78, clamp01(p.lum + 0.15 * shardRng()));
            const light = lerp(36, 72, clamp01(p.lum + 0.20 * shardRng()));
            const layerT = 1 - layer / (shardFloor + 2);

            const baseAlpha = p.shardAlpha * lerp(0.65, 1.25, layerT) * (1 + 0.35 * p.bleed) * (1 - 0.18 * p.edgeSharpness);
            const layerAlpha = baseAlpha * layerScale;

            ctx.save();
            ctx.globalCompositeOperation = (p.bleed > 0.55) ? 'screen' : ((layer % 2 === 0) ? 'lighter' : 'screen');

            ctx.fillStyle = hsl(shardHue, sat, light, layerAlpha);
            ctx.strokeStyle = hsl(shardHue, sat, light, layerAlpha * 1.15);

            for (let s = 0; s <= spsFloor; s++) {
                const isLastShard = s === spsFloor;

                const sides = 3 + Math.floor(shardRng() * 5);
                const radius = lerp(60, 235, shardRng()) * lerp(0.75, 1.10, layerT);
                const angle0 = shardRng() * Math.PI * 2;

                let x0 = lerp(W * 0.18, W * 0.82, shardRng());
                let y0 = lerp(H * 0.18, H * 0.86, shardRng());

                const n = nodes[Math.floor(shardRng() * nodes.length)];
                const attract = lerp(0.05, 0.24, p.density) * (0.7 + 0.7 * shardRng()) * n.weight;
                x0 = lerp(x0, n.x, attract);
                y0 = lerp(y0, n.y, attract);

                x0 += (shardRng() * 2 - 1) * (p.bleed * 24);
                y0 += (shardRng() * 2 - 1) * (p.bleed * 24);

                // Fractional last-shard fade
                if (isLastShard) {
                    const fracAlpha = layerAlpha * spsFrac;
                    ctx.fillStyle = hsl(shardHue, sat, light, fracAlpha);
                    ctx.strokeStyle = hsl(shardHue, sat, light, fracAlpha * 1.15);
                }

                drawShard(x0, y0, radius, sides, angle0, shardRng, p);

                const xm = mirrorX(x0, shardRng);
                const ym = y0 + (shardRng() * 2 - 1) * p.fracture * 18;
                drawShard(xm, ym, radius * lerp(0.92, 1.06, shardRng()), sides, angle0 + (shardRng() * 2 - 1) * p.fracture * 0.25, shardRng, p);
            }

            ctx.restore();
        }

        // Flow field
        if (p.flow > 0.01) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.lineCap = 'round';

            const grid = Math.floor(lerp(34, 92, clamp01(0.65 * p.flow + 0.35 * p.density)));
            const stepX = W / grid;
            const stepY = H / Math.floor(grid * (H / W));

            const flowHue = (p.hue + 120) % 360;
            ctx.strokeStyle = hsl(flowHue, lerp(28, 62, p.lum), lerp(52, 80, p.lum), lerp(0.06, 0.24, p.flow) * (1 + 0.25 * p.bleed));

            for (let gy = 0; gy <= H; gy += stepY) {
                for (let gx = 0; gx <= W; gx += stepX) {
                    const dx = gx - cx;
                    const dy = gy - cy;

                    let ang = Math.atan2(dy, dx) + Math.PI / 2;
                    const localNoise = signedNoise2D(gx, gy);
                    const curvature = lerp(0.4, 2.2, p.flow) * (1 + 0.6 * p.fracture) * (1 - 0.25 * p.symmetry);
                    ang += localNoise * curvature;

                    // nearest node pull
                    let nearest = nodes[0], bestD = Infinity;
                    for (const nd of nodes) {
                        const dd = (gx - nd.x) * (gx - nd.x) + (gy - nd.y) * (gy - nd.y);
                        if (dd < bestD) { bestD = dd; nearest = nd; }
                    }
                    const toN = Math.atan2(nearest.y - gy, nearest.x - gx);
                    ang = lerp(ang, toN, lerp(0.02, 0.14, p.density));

                    // multi-axis drift
                    if (p.multiAxis > 0.01) {
                        const altCenterX = cx + (gx < cx ? -1 : 1) * (p.multiAxis * 170);
                        const altDx = gx - altCenterX;
                        const altAng = Math.atan2(dy, altDx) + Math.PI / 2;
                        ang = lerp(ang, altAng, p.multiAxis * 0.45);
                    }

                    const len = lerp(4, 18, p.flow) * (0.7 + 0.6 * flowRng());
                    const x2 = gx + Math.cos(ang) * len;
                    const y2 = gy + Math.sin(ang) * len;

                    ctx.lineWidth = lerp(0.6, 1.8, p.flow) * (0.6 + 0.7 * flowRng()) * (1 - 0.15 * p.edgeSharpness);
                    ctx.beginPath();
                    ctx.moveTo(gx, gy);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }

        // Node glows — weighted by fractional node weight
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (const n of nodes) {
            const glowR = n.r * lerp(6.5, 12.0, p.lum) * (1 + 0.35 * p.bleed) * n.weight;
            const glowA = lerp(0.02, 0.09, aspects.radiance) * n.weight;
            softGlow(n.x, n.y, glowR, glowA);
            softGlow(mirrorX(n.x, nodeRng), n.y, glowR * 0.92, lerp(0.015, 0.065, aspects.radiance) * n.weight);
        }
        ctx.restore();

        vignette(lerp(0.32, 0.70, 1 - p.lum));
        addGrain(grainRng, clamp01(p.grain));

        const altText = generateAltText(aspects, nodes.length, title);

        return { title, altText, nodeCount: nodes.length, derived: p };
    }

    return { renderWith };
}
