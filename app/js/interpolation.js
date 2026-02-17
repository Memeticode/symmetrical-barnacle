/**
 * Seamless animation interpolation: Catmull-Rom splines, time-warp, cosine easing.
 */

import { clamp01, lerp } from './prng.js';

export const TIME_WARP_STRENGTH = 0.78;

export function smootherstep(t) {
    t = clamp01(t);
    return t * t * t * (t * (t * 6 - 15) + 10);
}

export function warpSegmentT(t, strength) {
    const w = smootherstep(t);
    return lerp(t, w, clamp01(strength));
}

export function cosineEase(t) {
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

export function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
        (2 * p1) +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
}

export function evalAspectsAt(tNorm, landmarks) {
    const n = landmarks.length;
    if (n < 2) return null;

    if (n === 2) {
        const a0 = landmarks[0].aspects;
        const a1 = landmarks[1].aspects;

        const phase = (tNorm < 0.5) ? (tNorm * 2) : (2 - tNorm * 2);
        const warped = warpSegmentT(phase, TIME_WARP_STRENGTH * 0.55);
        const u = cosineEase(warped);

        return {
            coherence: lerp(a0.coherence, a1.coherence, u),
            tension: lerp(a0.tension, a1.tension, u),
            recursion: lerp(a0.recursion, a1.recursion, u),
            motion: lerp(a0.motion, a1.motion, u),
            vulnerability: lerp(a0.vulnerability, a1.vulnerability, u),
            radiance: lerp(a0.radiance, a1.radiance, u),
        };
    }

    const seg = tNorm * n;
    const i1 = Math.floor(seg) % n;
    const tLinear = seg - Math.floor(seg);

    const t = warpSegmentT(tLinear, TIME_WARP_STRENGTH);

    const i0 = (i1 - 1 + n) % n;
    const i2 = (i1 + 1) % n;
    const i3 = (i1 + 2) % n;

    const A0 = landmarks[i0].aspects;
    const A1 = landmarks[i1].aspects;
    const A2 = landmarks[i2].aspects;
    const A3 = landmarks[i3].aspects;

    return {
        coherence: clamp01(catmullRom(A0.coherence, A1.coherence, A2.coherence, A3.coherence, t)),
        tension: clamp01(catmullRom(A0.tension, A1.tension, A2.tension, A3.tension, t)),
        recursion: clamp01(catmullRom(A0.recursion, A1.recursion, A2.recursion, A3.recursion, t)),
        motion: clamp01(catmullRom(A0.motion, A1.motion, A2.motion, A3.motion, t)),
        vulnerability: clamp01(catmullRom(A0.vulnerability, A1.vulnerability, A2.vulnerability, A3.vulnerability, t)),
        radiance: clamp01(catmullRom(A0.radiance, A1.radiance, A2.radiance, A3.radiance, t)),
    };
}
