/**
 * Aspect sliders → derived render parameters.
 */

import { clamp01, lerp } from './prng.js';

export function deriveParams(a, rng) {
    const symmetry = clamp01(lerp(0.25, 0.95, a.coherence) * (1 - 0.25 * a.tension));
    const fracture = clamp01(lerp(0.05, 0.85, a.tension) * (1 - 0.18 * a.coherence));
    const density = clamp01(lerp(0.15, 0.95, a.recursion) + 0.08 * a.vulnerability);
    const flow = clamp01(lerp(0.00, 0.95, a.motion) * (1 - 0.12 * a.coherence) + 0.03 * a.tension);
    const lum = clamp01(lerp(0.15, 0.95, a.radiance));
    const bleed = clamp01(lerp(0.00, 1.00, a.vulnerability) * (1 - 0.35 * a.tension));
    const edgeSharpness = clamp01(lerp(0.15, 0.95, a.tension) * (1 - 0.45 * a.vulnerability));
    const multiAxis = clamp01((1 - a.coherence) * a.tension);

    const paletteWobble = (rng() * 2 - 1) * 14;
    const baseHue =
        (a.radiance > 0.62)
            ? lerp(215, 315, rng())
            : lerp(190, 285, rng());
    const hue = (baseHue + lerp(-35, 45, a.tension) + paletteWobble + 360) % 360;

    const nodeCount = Math.floor(lerp(3, 11, density));
    const shardLayers = 2 + Math.floor(lerp(1, 6, density));
    const shardsPerLayer = 10 + Math.floor(lerp(8, 36, density));

    const grain = lerp(0.02, 0.08, 1 - lum) + 0.02 * fracture;
    const shardAlphaBase = lerp(0.04, 0.12, lum) * lerp(0.9, 1.25, 1 - edgeSharpness);
    const shardAlpha = clamp01(shardAlphaBase + 0.05 * bleed);

    return { symmetry, fracture, density, flow, lum, bleed, edgeSharpness, multiAxis, hue, nodeCount, shardLayers, shardsPerLayer, grain, shardAlpha };
}
