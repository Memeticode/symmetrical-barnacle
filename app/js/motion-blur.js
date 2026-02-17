/**
 * Temporal motion blur via decay buffer accumulation.
 *
 * Each frame:
 *   1) decay: acc *= (1 - decay)
 *   2) add:   acc += currentFrame * addStrength
 *   3) present: main canvas = acc
 */

import { clamp01 } from './prng.js';

export function createMotionBlur(mainCanvas, mainCtx, { decay = 0.18, add = 0.90 } = {}) {
    const acc = document.createElement('canvas');
    const accCtx = acc.getContext('2d', { alpha: true });
    let enabled = false;

    function resizeToMatch() {
        acc.width = mainCanvas.width;
        acc.height = mainCanvas.height;
        clear();
    }

    function clear() {
        accCtx.save();
        accCtx.globalCompositeOperation = 'source-over';
        accCtx.clearRect(0, 0, acc.width, acc.height);
        accCtx.restore();
    }

    function setEnabled(v) {
        enabled = !!v;
        if (!enabled) clear();
    }

    function apply() {
        if (!enabled) return;

        // 1) decay existing accumulation
        accCtx.save();
        accCtx.globalCompositeOperation = 'destination-in';
        accCtx.globalAlpha = 1 - clamp01(decay);
        accCtx.fillStyle = 'rgba(0,0,0,1)';
        accCtx.fillRect(0, 0, acc.width, acc.height);
        accCtx.restore();

        // 2) add current frame
        accCtx.save();
        accCtx.globalCompositeOperation = 'source-over';
        accCtx.globalAlpha = clamp01(add);
        accCtx.drawImage(mainCanvas, 0, 0);
        accCtx.restore();

        // 3) present accumulation to main canvas
        mainCtx.save();
        mainCtx.globalCompositeOperation = 'source-over';
        mainCtx.globalAlpha = 1.0;
        mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
        mainCtx.drawImage(acc, 0, 0);
        mainCtx.restore();
    }

    resizeToMatch();

    return { resizeToMatch, clear, setEnabled, apply };
}
