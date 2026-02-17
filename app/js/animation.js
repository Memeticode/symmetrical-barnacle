/**
 * Animation playback controller and programmatic frame export.
 *
 * Playback: pre-renders all frames into an ImageBitmap[] buffer,
 *           then blits from the buffer at 24fps via requestAnimationFrame.
 * Export:   encodes the pre-rendered buffer via WebCodecs + mp4-muxer
 *           when available, falls back to PNG frame sequence otherwise.
 */

import { evalAspectsAt } from './interpolation.js';
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';

export const ANIM_FPS = 24;
export const MOTION_BLUR_ENABLED = true;
export const MB_DECAY = 0.18;
export const MB_ADD = 0.90;

const PRE_ROLL_FRAMES = 12;

/**
 * Pre-render all animation frames into an ImageBitmap[] buffer.
 *
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {object} opts.renderer - createRenderer() instance
 * @param {object} opts.motionBlur - createMotionBlur() instance
 * @param {Array} opts.landmarks - ordered landmark objects with .aspects
 * @param {string} opts.seed - animation seed string
 * @param {number} opts.durationMs - total loop duration in milliseconds
 * @param {number} [opts.fps=24] - frames per second
 * @param {function} [opts.onProgress] - called with (done, total)
 * @param {function} [opts.isCancelled] - return true to abort
 * @returns {Promise<ImageBitmap[]|null>} - null if cancelled
 */
export async function preRenderFrames(opts) {
    const { canvas, renderer, motionBlur, landmarks, seed, durationMs, fps = ANIM_FPS, onProgress, isCancelled } = opts;

    const totalFrames = Math.max(1, Math.round(durationMs / 1000 * fps));

    // Pre-roll: warm motion blur so frame 0 has blur history (seamless loop)
    motionBlur.setEnabled(MOTION_BLUR_ENABLED);
    motionBlur.clear();
    for (let p = PRE_ROLL_FRAMES; p > 0; p--) {
        const preT = (((-p / totalFrames) % 1) + 1) % 1;
        const aspects = evalAspectsAt(preT, landmarks);
        renderer.renderWith(seed, aspects);
        motionBlur.apply();
    }

    const frames = [];

    for (let f = 0; f < totalFrames; f++) {
        if (isCancelled?.()) {
            for (const bm of frames) bm.close();
            return null;
        }

        const tNorm = f / totalFrames;
        const aspects = evalAspectsAt(tNorm, landmarks);
        renderer.renderWith(seed, aspects);
        motionBlur.apply();

        const bitmap = await createImageBitmap(canvas);
        frames.push(bitmap);

        onProgress?.(f + 1, totalFrames);

        // Yield every 4 frames for UI responsiveness
        if ((f & 3) === 3) await new Promise(r => setTimeout(r, 0));
    }

    return frames;
}


/**
 * Create a playback controller bound to the given canvas + modules.
 *
 * @param {object} opts
 * @param {object} opts.renderer - createRenderer() instance
 * @param {object} opts.motionBlur - createMotionBlur() instance
 * @param {function} opts.drawFrame - called with (ImageBitmap) to blit a frame
 * @param {function} opts.getLandmarks - returns array of { name, aspects, ... }
 * @param {function} opts.getAnimSeed - returns the current animation seed string
 * @param {function} opts.getLoopDurationMs - returns current loop duration in ms
 * @param {function} opts.onFrame - called with (tNorm, frameIndex) each rendered frame
 * @param {function} opts.onPlayStateChange - called with (playing: boolean)
 */
export function createAnimationController(opts) {
    const { drawFrame, onFrame, onPlayStateChange } = opts;

    const state = {
        playing: false,
        startMs: 0,
        lastFrameIndex: -1,
        frames: null,
        durationMs: 0,
    };

    function tickBuffer(nowMs) {
        if (!state.playing || !state.frames) return;

        const elapsed = nowMs - state.startMs;
        const wrapped = ((elapsed % state.durationMs) + state.durationMs) % state.durationMs;
        const tNorm = wrapped / state.durationMs;

        const frameIndex = Math.min(
            Math.floor(tNorm * state.frames.length),
            state.frames.length - 1
        );

        if (frameIndex !== state.lastFrameIndex) {
            drawFrame(state.frames[frameIndex]);
            onFrame?.(tNorm, frameIndex);
            state.lastFrameIndex = frameIndex;
        }

        requestAnimationFrame(tickBuffer);
    }

    function playFromBuffer(frames, durationMs) {
        if (!frames || frames.length === 0) return false;

        state.playing = true;
        state.frames = frames;
        state.durationMs = durationMs;
        state.startMs = performance.now();
        state.lastFrameIndex = -1;

        onPlayStateChange?.(true);
        requestAnimationFrame(tickBuffer);
        return true;
    }

    function pause() {
        state.playing = false;
        onPlayStateChange?.(false);
    }

    function toggle(frames, durationMs) {
        if (state.playing) {
            pause();
        } else {
            return playFromBuffer(frames, durationMs);
        }
    }

    function stop() {
        state.playing = false;
        onPlayStateChange?.(false);
    }

    function isPlaying() { return state.playing; }

    return { playFromBuffer, pause, toggle, stop, isPlaying };
}


/**
 * Encode pre-rendered ImageBitmap[] into a downloadable format.
 *
 * Primary path: WebCodecs VideoEncoder + mp4-muxer -> MP4 blob
 * Fallback: PNG frame sequence
 *
 * @param {object} opts
 * @param {ImageBitmap[]} opts.frames - pre-rendered frame bitmaps
 * @param {number} opts.fps - frames per second
 * @param {number} opts.durationMs - total duration in ms
 * @param {string} opts.seed - animation seed string
 * @param {HTMLCanvasElement} opts.canvas - used for dimensions and PNG fallback
 * @param {function} [opts.onProgress] - called with (tNorm)
 * @returns {Promise<{ kind: 'video'|'frames', blob?, frames?, ext?, fps, durationMs, seed, totalFrames }>}
 */
export async function exportFromBuffer(opts) {
    const { frames, fps = ANIM_FPS, durationMs, seed, canvas, onProgress } = opts;
    const totalFrames = frames.length;
    const frameDurationUs = Math.round(1_000_000 / fps);

    // Try WebCodecs path
    if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
        const result = await _exportBufferViaWebCodecs({ frames, canvas, totalFrames, frameDurationUs, fps, durationMs, seed, onProgress });
        if (result) return result;
    }

    // Fallback: PNG frames
    return _exportBufferViaPng({ frames, canvas, totalFrames, fps, durationMs, seed, onProgress });
}


async function _exportBufferViaWebCodecs({ frames, canvas, totalFrames, frameDurationUs, fps, durationMs, seed, onProgress }) {
    const W = canvas.width, H = canvas.height;

    const codecCandidates = [
        { codec: 'avc1.42E01E', container: 'mp4', muxCodec: 'avc' },
        { codec: 'avc1.640028', container: 'mp4', muxCodec: 'avc' },
    ];

    let chosen = null;
    for (const c of codecCandidates) {
        try {
            const support = await VideoEncoder.isConfigSupported({
                codec: c.codec,
                width: W,
                height: H,
                bitrate: 8_000_000,
                framerate: fps,
            });
            if (support.supported) { chosen = c; break; }
        } catch { /* skip */ }
    }

    if (!chosen) return null;

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
        target,
        video: {
            codec: chosen.muxCodec,
            width: W,
            height: H,
        },
        fastStart: 'in-memory',
    });

    const encoder = new VideoEncoder({
        output: (chunk, meta) => { muxer.addVideoChunk(chunk, meta); },
        error: (e) => { console.error('VideoEncoder error:', e); },
    });

    encoder.configure({
        codec: chosen.codec,
        width: W,
        height: H,
        bitrate: 8_000_000,
        framerate: fps,
        latencyMode: 'quality',
    });

    try {
        for (let f = 0; f < totalFrames; f++) {
            const timestamp = f * frameDurationUs;
            const frame = new VideoFrame(frames[f], { timestamp, duration: frameDurationUs });

            const isKey = (f % (fps * 2) === 0);
            encoder.encode(frame, { keyFrame: isKey });
            frame.close();

            onProgress?.(f / totalFrames);

            if ((f & 7) === 7) await new Promise(r => setTimeout(r, 0));
        }

        await encoder.flush();
        encoder.close();
        muxer.finalize();

        const { buffer } = target;
        const blob = new Blob([buffer], { type: 'video/mp4' });

        if (blob.size < 1024) return null;

        return { kind: 'video', blob, ext: 'mp4', fps, durationMs, seed, totalFrames };

    } catch (err) {
        console.warn('WebCodecs export failed, falling back to PNG frames:', err);
        try { encoder.close(); } catch { /* ignore */ }
        return null;
    }
}


async function _exportBufferViaPng({ frames, canvas, totalFrames, fps, durationMs, seed, onProgress }) {
    // Draw each ImageBitmap to a temp canvas and convert to PNG blob
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = canvas.width;
    tmpCanvas.height = canvas.height;
    const tmpCtx = tmpCanvas.getContext('2d');

    const pngFrames = [];

    for (let f = 0; f < totalFrames; f++) {
        tmpCtx.clearRect(0, 0, tmpCanvas.width, tmpCanvas.height);
        tmpCtx.drawImage(frames[f], 0, 0);

        const blob = await new Promise(r => tmpCanvas.toBlob(r, 'image/png'));
        pngFrames.push({ index: f, blob });

        onProgress?.(f / totalFrames);

        await new Promise(r => setTimeout(r, 0));
    }

    return { kind: 'frames', frames: pngFrames, fps, durationMs, seed, totalFrames };
}
