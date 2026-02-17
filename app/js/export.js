/**
 * Export helpers: ZIP packaging, downloads, metadata generation.
 */

import { xmur3, mulberry32 } from './prng.js';
import { deriveParams } from './params.js';
import { generateTitle, generateAltText } from './text.js';
import { evalAspectsAt } from './interpolation.js';
import { ANIM_FPS, MOTION_BLUR_ENABLED, MB_DECAY, MB_ADD } from './animation.js';

export function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function toIsoLocalish(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function canvasToPngBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

export function safeName(s) {
    return (s || 'seed').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
}

export function computeKeyframeText(seedForTitles, landmarks) {
    const out = [];
    for (const k of landmarks) {
        const seedFn = xmur3(seedForTitles + '::' + k.name);
        const rng = mulberry32(seedFn());
        const title = generateTitle(k.aspects, rng);

        const seedFn2 = xmur3(seedForTitles + '::alt::' + k.name);
        const rng2 = mulberry32(seedFn2());
        const derived = deriveParams(k.aspects, rng2);
        const nodeCount = derived.nodeCount;

        const alt = generateAltText(k.aspects, nodeCount, title);

        out.push({
            name: k.name,
            note: k.note ?? '',
            aspects: k.aspects,
            title,
            altText: alt
        });
    }
    return out;
}

export function computeLoopSummaryTitleAlt(seed, landmarks) {
    const a0 = evalAspectsAt(0.0, landmarks);
    const seedFn = xmur3(seed + '::bundle');
    const rng = mulberry32(seedFn());
    const title = generateTitle(a0, rng);

    const seedFn2 = xmur3(seed + '::bundle-alt');
    const rng2 = mulberry32(seedFn2());
    const derived = deriveParams(a0, rng2);
    const altText = generateAltText(a0, derived.nodeCount, title);

    return { title, altText };
}

/**
 * Package and download a still image ZIP.
 */
export async function packageStillZip(canvas, { seed, aspects, note, meta }) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error('JSZip not loaded');

    const pngBlob = await canvasToPngBlob(canvas);
    const ts = toIsoLocalish(new Date());
    const base = `still_${safeName(seed)}_${ts}`;

    const zip = new JSZip();
    zip.file(`${base}/image.png`, pngBlob);
    zip.file(`${base}/title.txt`, meta.title + '\n');
    zip.file(`${base}/alt-text.txt`, meta.altText + '\n');
    zip.file(`${base}/note.txt`, (note || '') + '\n');

    const metadata = {
        kind: 'still',
        seed,
        note,
        aspects,
        title: meta.title,
        generated_at: new Date().toISOString(),
        canvas: { width: canvas.width, height: canvas.height }
    };
    zip.file(`${base}/metadata.json`, JSON.stringify(metadata, null, 2) + '\n');

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(`${base}.zip`, zipBlob);
}

/**
 * Package and download an animation ZIP.
 */
export async function packageAnimZip(rec, { landmarks, loopLandmarkNames, timeWarpStrength }) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error('JSZip not loaded');

    const ts = toIsoLocalish(new Date());
    const base = `animation_${safeName(rec.seed)}_${ts}`;

    const keyframes = computeKeyframeText(rec.seed, landmarks);
    const summary = computeLoopSummaryTitleAlt(rec.seed, landmarks);

    const zip = new JSZip();

    if (rec.kind === 'video') {
        zip.file(`${base}/animation.${rec.ext}`, rec.blob);
    } else {
        const framesDir = `${base}/frames`;
        for (const fr of rec.frames) {
            const name = String(fr.index).padStart(5, '0');
            zip.file(`${framesDir}/frame_${name}.png`, fr.blob);
        }
        zip.file(`${base}/frames/README.txt`,
            'This export contains a PNG frame sequence because video encoding was not supported on this browser.\n' +
            'You can assemble frames into a video with ffmpeg, e.g.\n' +
            `ffmpeg -framerate ${rec.fps} -i frame_%05d.png -c:v libx264 -pix_fmt yuv420p out.mp4\n`
        );
    }

    zip.file(`${base}/title.txt`, summary.title + '\n');
    zip.file(`${base}/alt-text.txt`, summary.altText + '\n');
    zip.file(`${base}/keyframes.json`, JSON.stringify(keyframes, null, 2) + '\n');

    const manifest = {
        kind: 'animation',
        export_kind: rec.kind,
        seed: rec.seed,
        fps: rec.fps,
        duration_ms: rec.durationMs,
        total_frames: rec.totalFrames,
        time_warp_strength: timeWarpStrength,
        motion_blur: {
            enabled: MOTION_BLUR_ENABLED,
            decay: MB_DECAY,
            add: MB_ADD
        },
        landmarks: loopLandmarkNames.slice(),
        generated_at: new Date().toISOString(),
        files: rec.kind === 'video'
            ? [`animation.${rec.ext}`, 'title.txt', 'alt-text.txt', 'keyframes.json', 'manifest.json']
            : ['frames/*', 'title.txt', 'alt-text.txt', 'keyframes.json', 'manifest.json']
    };
    zip.file(`${base}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(`${base}.zip`, zipBlob);
}
