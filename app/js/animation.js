/**
 * Animation playback controller and programmatic frame export.
 *
 * Playback: requestAnimationFrame tick loop at 24fps.
 * Export: renders frames as fast as CPU allows (no real-time pacing),
 *         encodes via WebCodecs + mp4-muxer when available,
 *         falls back to PNG frame sequence otherwise.
 */

import { evalAspectsAt } from './interpolation.js';
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';

export const ANIM_FPS = 24;
export const MOTION_BLUR_ENABLED = true;
export const MB_DECAY = 0.18;
export const MB_ADD = 0.90;

const PRE_ROLL_FRAMES = 12;

/**
 * Create a playback controller bound to the given canvas + modules.
 *
 * @param {object} opts
 * @param {object} opts.renderer - createRenderer() instance
 * @param {object} opts.motionBlur - createMotionBlur() instance
 * @param {function} opts.getLandmarks - returns array of { name, aspects, ... }
 * @param {function} opts.getAnimSeed - returns the current animation seed string
 * @param {function} opts.getLoopDurationMs - returns current loop duration in ms
 * @param {function} opts.onFrame - called with (tNorm, meta) each rendered frame
 * @param {function} opts.onPlayStateChange - called with (playing: boolean)
 */
export function createAnimationController(opts) {
    const { renderer, motionBlur, getLandmarks, getAnimSeed, getLoopDurationMs, onFrame, onPlayStateChange } = opts;

    const state = {
        playing: false,
        startMs: 0,
        lastFrameIndex: -1,
    };

    function tick(nowMs) {
        if (!state.playing) return;

        const landmarks = getLandmarks();
        if (landmarks.length < 2) {
            state.playing = false;
            onPlayStateChange?.(false);
            return;
        }

        const durationMs = getLoopDurationMs();
        const elapsed = nowMs - state.startMs;
        const wrapped = ((elapsed % durationMs) + durationMs) % durationMs;
        const tNorm = wrapped / durationMs;

        const frameInterval = 1000 / ANIM_FPS;
        const frameIndex = Math.floor(wrapped / frameInterval);

        if (frameIndex !== state.lastFrameIndex) {
            const aspects = evalAspectsAt(tNorm, landmarks);
            const seed = getAnimSeed();
            const meta = renderer.renderWith(seed, aspects);
            motionBlur.apply();
            onFrame?.(tNorm, meta);
            state.lastFrameIndex = frameIndex;
        }

        requestAnimationFrame(tick);
    }

    function play() {
        if (state.playing) return;
        const landmarks = getLandmarks();
        if (landmarks.length < 2) return false;

        state.playing = true;
        state.startMs = performance.now();
        state.lastFrameIndex = -1;

        motionBlur.setEnabled(MOTION_BLUR_ENABLED);
        motionBlur.clear();

        onPlayStateChange?.(true);
        requestAnimationFrame(tick);
        return true;
    }

    function pause() {
        state.playing = false;
        onPlayStateChange?.(false);
    }

    function toggle() {
        if (state.playing) pause(); else return play();
    }

    function stop() {
        state.playing = false;
        onPlayStateChange?.(false);
    }

    function isPlaying() { return state.playing; }

    return { play, pause, toggle, stop, isPlaying };
}


/**
 * Export animation frames programmatically — no real-time pacing.
 *
 * Primary path: WebCodecs VideoEncoder + mp4-muxer → MP4 blob
 * Fallback: PNG frame sequence (for browsers without WebCodecs)
 *
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {object} opts.renderer - createRenderer() instance
 * @param {object} opts.motionBlur - createMotionBlur() instance
 * @param {Array} opts.landmarks - ordered landmark objects with .aspects
 * @param {string} opts.seed - animation seed string
 * @param {number} opts.durationMs - total loop duration in milliseconds
 * @param {number} [opts.fps=24] - frames per second
 * @param {function} [opts.onProgress] - called with (tNorm) for UI progress
 * @returns {Promise<{ kind: 'video'|'frames', blob?, frames?, ext?, fps, durationMs, seed, totalFrames }>}
 */
export async function exportAnimation(opts) {
    const { canvas, renderer, motionBlur, landmarks, seed, durationMs, fps = ANIM_FPS, onProgress } = opts;

    const totalFrames = Math.max(1, Math.round(durationMs / 1000 * fps));
    const frameDurationUs = Math.round(1_000_000 / fps);

    // Pre-roll: warm motion blur so frame 0 has blur history (seamless loop)
    motionBlur.setEnabled(MOTION_BLUR_ENABLED);
    motionBlur.clear();
    for (let p = PRE_ROLL_FRAMES; p > 0; p--) {
        const preT = (((-p / totalFrames) % 1) + 1) % 1;
        const aspects = evalAspectsAt(preT, landmarks);
        renderer.renderWith(seed, aspects);
        motionBlur.apply();
    }

    // Try WebCodecs path
    if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
        const result = await _exportViaWebCodecs({ canvas, renderer, motionBlur, landmarks, seed, totalFrames, frameDurationUs, fps, durationMs, onProgress });
        if (result) return result;
    }

    // Fallback: PNG frames
    return _exportViaPngFrames({ canvas, renderer, motionBlur, landmarks, seed, totalFrames, fps, durationMs, onProgress });
}


async function _exportViaWebCodecs({ canvas, renderer, motionBlur, landmarks, seed, totalFrames, frameDurationUs, fps, durationMs, onProgress }) {
    const W = canvas.width, H = canvas.height;

    // Negotiate codec — prefer H.264 (broadest playback), then VP8
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

    // Set up muxer
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

    // Set up encoder
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
            const tNorm = f / totalFrames;
            const aspects = evalAspectsAt(tNorm, landmarks);
            renderer.renderWith(seed, aspects);
            motionBlur.apply();

            const timestamp = f * frameDurationUs;
            const bitmap = await createImageBitmap(canvas);
            const frame = new VideoFrame(bitmap, { timestamp, duration: frameDurationUs });
            bitmap.close();

            const isKey = (f % (fps * 2) === 0);
            encoder.encode(frame, { keyFrame: isKey });
            frame.close();

            onProgress?.(tNorm);

            // Yield to keep UI responsive — no waitUntil, no real-time pacing
            if ((f & 7) === 7) await new Promise(r => setTimeout(r, 0));
        }

        await encoder.flush();
        encoder.close();
        muxer.finalize();

        const { buffer } = target;
        const blob = new Blob([buffer], { type: 'video/mp4' });

        if (blob.size < 1024) return null; // something went wrong

        return { kind: 'video', blob, ext: 'mp4', fps, durationMs, seed, totalFrames };

    } catch (err) {
        console.warn('WebCodecs export failed, falling back to PNG frames:', err);
        try { encoder.close(); } catch { /* ignore */ }
        return null;
    }
}


async function _exportViaPngFrames({ canvas, renderer, motionBlur, landmarks, seed, totalFrames, fps, durationMs, onProgress }) {
    const frames = [];

    for (let f = 0; f < totalFrames; f++) {
        const tNorm = f / totalFrames;
        const aspects = evalAspectsAt(tNorm, landmarks);
        renderer.renderWith(seed, aspects);
        motionBlur.apply();

        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        frames.push({ index: f, blob });

        onProgress?.(tNorm);

        // Yield every frame to keep UI alive — no real-time pacing needed
        await new Promise(r => setTimeout(r, 0));
    }

    return { kind: 'frames', frames, fps, durationMs, seed, totalFrames };
}
