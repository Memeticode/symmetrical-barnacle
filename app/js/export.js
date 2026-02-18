/**
 * Export helpers: ZIP packaging, downloads, metadata generation.
 */

import { xmur3, mulberry32 } from './prng.js';
import { deriveParams } from './params.js';
import { generateTitle, generateAltText, generateAnimAltText } from './text.js';
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

/* ── PNG tEXt chunk injection ── */

function crc32Table() {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c;
    }
    return t;
}

const CRC_TABLE = crc32Table();

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makePngTextChunk(keyword, text) {
    const enc = new TextEncoder();
    const kwBytes = enc.encode(keyword);
    const txtBytes = enc.encode(text);
    const dataLen = kwBytes.length + 1 + txtBytes.length; // keyword + null + text
    const chunk = new Uint8Array(4 + 4 + dataLen + 4); // length + type + data + crc
    const view = new DataView(chunk.buffer);
    view.setUint32(0, dataLen);
    chunk.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
    chunk.set(kwBytes, 8);
    chunk[8 + kwBytes.length] = 0; // null separator
    chunk.set(txtBytes, 8 + kwBytes.length + 1);
    const crcData = chunk.subarray(4, 4 + 4 + dataLen); // type + data
    view.setUint32(4 + 4 + dataLen, crc32(crcData));
    return chunk;
}

/**
 * Inject PNG tEXt metadata chunks into a PNG blob.
 * @param {Blob} pngBlob
 * @param {{ keyword: string, text: string }[]} entries
 * @returns {Promise<Blob>}
 */
export async function injectPngTextChunks(pngBlob, entries) {
    const buf = await pngBlob.arrayBuffer();
    const src = new Uint8Array(buf);
    // Find IEND chunk: scan for "IEND" (0x49454E44) from the end
    let iendPos = -1;
    for (let i = src.length - 12; i >= 8; i--) {
        if (src[i + 4] === 0x49 && src[i + 5] === 0x45 && src[i + 6] === 0x4E && src[i + 7] === 0x44) {
            iendPos = i;
            break;
        }
    }
    if (iendPos < 0) return pngBlob; // couldn't find IEND, return unchanged

    const chunks = entries.map(e => makePngTextChunk(e.keyword, e.text));
    const totalExtra = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(src.length + totalExtra);
    out.set(src.subarray(0, iendPos), 0);
    let offset = iendPos;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    out.set(src.subarray(iendPos), offset);
    return new Blob([out], { type: 'image/png' });
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

export function computeLoopSummaryTitleAlt(seed, landmarks, durationSecs) {
    const a0 = evalAspectsAt(0.0, landmarks);
    const seedFn = xmur3(seed + '::bundle');
    const rng = mulberry32(seedFn());
    const title = generateTitle(a0, rng);

    const keyframeTexts = computeKeyframeText(seed, landmarks);
    const altText = generateAnimAltText(landmarks, durationSecs, keyframeTexts);

    return { title, altText };
}

/**
 * Package and download a still image ZIP.
 */
export async function packageStillZip(canvas, { seed, aspects, note, meta }) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error('JSZip not loaded');

    const rawPng = await canvasToPngBlob(canvas);
    const pngBlob = await injectPngTextChunks(rawPng, [
        { keyword: 'Title', text: meta.title },
        { keyword: 'Description', text: meta.altText },
    ]);
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
    const summary = computeLoopSummaryTitleAlt(rec.seed, landmarks, rec.durationMs / 1000);

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
