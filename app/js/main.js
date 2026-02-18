/**
 * Entry point — wires all modules to the DOM.
 */

import { createRenderer } from './renderer.js';
import { createMotionBlur } from './motion-blur.js';
import { evalAspectsAt, TIME_WARP_STRENGTH } from './interpolation.js';
import { loadProfiles, saveProfiles, deleteProfile, refreshProfileSelect, ensureStarterProfiles, renderLoopList, loadAnimProfiles, saveAnimProfiles, deleteAnimProfile, findAnimProfilesReferencingImage, removeImageFromAnimProfiles } from './profiles.js';
import { createAnimationController, preRenderFrames, exportFromBuffer, ANIM_FPS, MOTION_BLUR_ENABLED, MB_DECAY, MB_ADD } from './animation.js';
import { packageStillZip, packageAnimZip, computeLoopSummaryTitleAlt } from './export.js';
import { initTheme } from './theme.js';
import { createLoadingAnimation } from './loading-animation.js';

/* ---------------------------
 * DOM references
 * ---------------------------
 */
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const el = {
    modeImage: document.getElementById('modeImage'),
    modeAnim: document.getElementById('modeAnim'),
    imageSection: document.getElementById('imageModeSection'),
    animSection: document.getElementById('animModeSection'),

    seed: document.getElementById('seed'),

    coherence: document.getElementById('coherence'),
    tension: document.getElementById('tension'),
    recursion: document.getElementById('recursion'),
    motion: document.getElementById('motion'),
    vulnerability: document.getElementById('vulnerability'),
    radiance: document.getElementById('radiance'),

    cohLabel: document.getElementById('cohLabel'),
    tenLabel: document.getElementById('tenLabel'),
    recLabel: document.getElementById('recLabel'),
    motLabel: document.getElementById('motLabel'),
    vulLabel: document.getElementById('vulLabel'),
    radLabel: document.getElementById('radLabel'),

    note: document.getElementById('note'),
    profileName: document.getElementById('profileName'),
    saveProfile: document.getElementById('saveProfile'),
    randomize: document.getElementById('randomize'),
    profileGallery: document.getElementById('profileGallery'),
    animProfileGallery: document.getElementById('animProfileGallery'),
    saveAnimProfile: document.getElementById('saveAnimProfile'),
    animProfileName: document.getElementById('animProfileName'),
    animNote: document.getElementById('animNote'),

    profileSelect: document.getElementById('profileSelect'),
    addToLoop: document.getElementById('addToLoop'),
    clearLoop: document.getElementById('clearLoop'),
    loopList: document.getElementById('loopList'),
    progressBar: document.getElementById('progressBar'),

    loopDuration: document.getElementById('loopDuration'),
    durationLabel: document.getElementById('durationLabel'),

    titleText: document.getElementById('titleText'),
    altText: document.getElementById('altText'),
    toast: document.getElementById('toast'),

    developerStatement: document.getElementById('developerStatement'),
    artistStatement: document.getElementById('artistStatement'),
    statementModal: document.getElementById('statementModal'),
    statementModalClose: document.getElementById('statementModalClose'),
    statementTitle: document.getElementById('statementTitle'),
    developerBody: document.getElementById('developerBody'),
    artistBody: document.getElementById('artistBody'),

    canvasOverlay: document.getElementById('canvasOverlay'),
    canvasOverlayText: document.getElementById('canvasOverlayText'),
    renderBtn: document.getElementById('renderBtn'),
    exportBtn: document.getElementById('exportBtn'),
    progressContainer: document.getElementById('progressContainer'),
    imageProfileSelect: document.getElementById('imageProfileSelect'),

    infoModal: document.getElementById('infoModal'),
    infoModalTitle: document.getElementById('infoModalTitle'),
    infoModalBody: document.getElementById('infoModalBody'),
    infoModalClose: document.getElementById('infoModalClose'),
};

/* ---------------------------
 * Module instances
 * ---------------------------
 */
const renderer = createRenderer(canvas, ctx);
const motionBlur = createMotionBlur(canvas, ctx, { decay: MB_DECAY, add: MB_ADD });
const loadingAnim = createLoadingAnimation(document.querySelector('.canvas-overlay-inner'));

/* ---------------------------
 * Thumbnail generator (full-resolution offscreen → dataURL → <img>)
 * ---------------------------
 */
const thumbOffscreen = document.createElement('canvas');
thumbOffscreen.width = 1400;
thumbOffscreen.height = 900;
const thumbOffCtx = thumbOffscreen.getContext('2d');
const thumbRenderer = createRenderer(thumbOffscreen, thumbOffCtx);

/* ── Thumbnail cache + staggered render queue ── */
const thumbCache = new Map();           // cacheKey → dataURL
const thumbQueue = [];                  // pending { seed, aspects, destImg, key }
let thumbProcessing = false;

function thumbCacheKey(seed, aspects) {
    return seed + '|' + JSON.stringify(aspects);
}

/**
 * Queue a thumbnail render. Hits cache instantly if available,
 * otherwise defers to a staggered queue so heavy renders don't
 * block the main thread back-to-back (keeps loading animation smooth).
 */
function queueThumbnail(seed, aspects, destImg) {
    const key = thumbCacheKey(seed, aspects);
    if (thumbCache.has(key)) {
        destImg.src = thumbCache.get(key);
        return;
    }
    thumbQueue.push({ seed, aspects, destImg, key });
    drainThumbQueue();
}

function drainThumbQueue() {
    if (thumbProcessing || thumbQueue.length === 0) return;
    thumbProcessing = true;
    // Gap of ~50ms between renders → loading animation gets 2-3 smooth frames
    setTimeout(() => {
        const item = thumbQueue.shift();
        if (item && item.destImg.isConnected) {
            thumbRenderer.renderWith(item.seed, item.aspects);
            const url = thumbOffscreen.toDataURL('image/png');
            thumbCache.set(item.key, url);
            item.destImg.src = url;
        }
        thumbProcessing = false;
        drainThumbQueue();
    }, 50);
}

/** Synchronous render (used only when immediate result is needed). */
function renderThumbnail(seed, aspects, destImg) {
    const key = thumbCacheKey(seed, aspects);
    if (thumbCache.has(key)) {
        destImg.src = thumbCache.get(key);
        return;
    }
    thumbRenderer.renderWith(seed, aspects);
    const url = thumbOffscreen.toDataURL('image/png');
    thumbCache.set(key, url);
    destImg.src = url;
}

/* ---------------------------
 * Custom select wrapper
 * ---------------------------
 * Wraps a native <select> with a styled dropdown that shows thumbnails.
 * The native select stays in the DOM (hidden) as the source of truth for
 * .value and change events, so all existing code keeps working.
 */
function wrapSelect(selectEl, { getProfile }) {
    // Build DOM structure
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';

    const dropdown = document.createElement('div');
    dropdown.className = 'custom-select-dropdown';

    // Insert wrapper where the select was
    selectEl.parentNode.insertBefore(wrapper, selectEl);
    wrapper.appendChild(selectEl);  // moves select inside wrapper
    wrapper.appendChild(trigger);
    wrapper.appendChild(dropdown);

    let focusedIdx = -1;

    function isOpen() { return wrapper.classList.contains('open'); }

    function open() {
        wrapper.classList.add('open');
        focusedIdx = -1;
        // Scroll selected option into view
        const sel = dropdown.querySelector('.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    function close() {
        wrapper.classList.remove('open');
        clearFocus();
    }

    function toggle() { isOpen() ? close() : open(); }

    function clearFocus() {
        focusedIdx = -1;
        dropdown.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
    }

    function focusOption(idx) {
        const opts = dropdown.querySelectorAll('.custom-select-option');
        if (opts.length === 0) return;
        clearFocus();
        focusedIdx = Math.max(0, Math.min(idx, opts.length - 1));
        opts[focusedIdx].classList.add('focused');
        opts[focusedIdx].scrollIntoView({ block: 'nearest' });
    }

    function selectValue(value) {
        if (selectEl.value !== value) {
            selectEl.value = value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        updateTrigger();
        close();
    }

    function updateTrigger() {
        const value = selectEl.value;
        const opt = selectEl.options[selectEl.selectedIndex];
        const text = opt ? opt.textContent : '';
        const isPlaceholder = !value;
        const profile = value ? getProfile(value) : null;

        trigger.innerHTML = '';

        if (profile?.seed && profile?.aspects) {
            const img = document.createElement('img');
            img.className = 'cs-thumb';
            queueThumbnail(profile.seed, { ...profile.aspects }, img);
            trigger.appendChild(img);
        }

        const label = document.createElement('span');
        label.className = isPlaceholder ? 'cs-label cs-placeholder' : 'cs-label';
        label.textContent = text || 'Select\u2026';
        trigger.appendChild(label);

        const arrow = document.createElement('span');
        arrow.className = 'cs-arrow';
        arrow.textContent = '\u25be';
        trigger.appendChild(arrow);
    }

    function refresh() {
        // Rebuild dropdown options from native select's options
        dropdown.innerHTML = '';
        const currentValue = selectEl.value;

        for (const opt of selectEl.options) {
            const div = document.createElement('div');
            div.className = 'custom-select-option';
            if (opt.value === currentValue) div.classList.add('selected');

            if (!opt.value) {
                // Placeholder option
                div.classList.add('cs-placeholder');
            } else {
                const profile = getProfile(opt.value);
                if (profile?.seed && profile?.aspects) {
                    const img = document.createElement('img');
                    img.className = 'cs-thumb';
                    queueThumbnail(profile.seed, { ...profile.aspects }, img);
                    div.appendChild(img);
                }
            }

            const label = document.createElement('span');
            label.className = 'cs-opt-label';
            label.textContent = opt.textContent;
            div.appendChild(label);

            div.addEventListener('click', () => selectValue(opt.value));
            dropdown.appendChild(div);
        }

        updateTrigger();
    }

    // --- Event listeners ---

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle();
    });

    trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!isOpen()) { open(); }
            const opts = dropdown.querySelectorAll('.custom-select-option');
            if (opts.length === 0) return;
            if (e.key === 'ArrowDown') focusOption(focusedIdx + 1);
            else focusOption(focusedIdx - 1);
        }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!isOpen()) { open(); return; }
            const opts = dropdown.querySelectorAll('.custom-select-option');
            if (focusedIdx >= 0 && focusedIdx < opts.length) {
                opts[focusedIdx].click();
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (isOpen() && !wrapper.contains(e.target)) close();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) close();
    });

    refresh();
    return { refresh };
}

/* Wrap profile selects with custom dropdown UI */
const imageSelectUI = wrapSelect(el.imageProfileSelect, {
    getProfile: name => loadProfiles()[name],
});
const animSelectUI = wrapSelect(el.profileSelect, {
    getProfile: name => loadProfiles()[name],
});

/* ---------------------------
 * State
 * ---------------------------
 */
let currentMode = 'image';
let loopLandmarks = [];
let loopDurationMs = 7_000;

let stillRendered = false;
let loadedProfileName = '';

const frameBuffer = {
    frames: [],
    rendered: false,
    durationMs: 0,
    seed: '',
    rendering: false,
};

/* ---------------------------
 * Frame buffer management
 * ---------------------------
 */
function invalidateFrameBuffer() {
    animController.stop();
    for (const bm of frameBuffer.frames) {
        try { bm.close(); } catch { /* ignore */ }
    }
    frameBuffer.frames = [];
    frameBuffer.rendered = false;
    frameBuffer.durationMs = 0;
    frameBuffer.seed = '';

    el.exportBtn.disabled = true;
    el.renderBtn.disabled = false;
    el.renderBtn.textContent = 'Render';
    el.progressBar.style.width = '0%';

    if (currentMode === 'anim') {
        showCanvasOverlay('Render to preview');
        el.titleText.textContent = '';
        el.altText.textContent = '';
    }
}

/* ---------------------------
 * Helpers
 * ---------------------------
 */
function toast(msg) {
    el.toast.textContent = msg;
    if (!msg) return;
    setTimeout(() => { if (el.toast.textContent === msg) el.toast.textContent = ''; }, 2400);
}

function readAspectsFromUI() {
    return {
        coherence: parseFloat(el.coherence.value),
        tension: parseFloat(el.tension.value),
        recursion: parseFloat(el.recursion.value),
        motion: parseFloat(el.motion.value),
        vulnerability: parseFloat(el.vulnerability.value),
        radiance: parseFloat(el.radiance.value),
    };
}

function updateAspectLabels(a) {
    el.cohLabel.textContent = a.coherence.toFixed(2);
    el.tenLabel.textContent = a.tension.toFixed(2);
    el.recLabel.textContent = a.recursion.toFixed(2);
    el.motLabel.textContent = a.motion.toFixed(2);
    el.vulLabel.textContent = a.vulnerability.toFixed(2);
    el.radLabel.textContent = a.radiance.toFixed(2);
}

function readNote() { return (el.note.value ?? '').trim(); }

/* Profile dropdown for image mode */
function refreshImageProfileSelect() {
    const profiles = loadProfiles();
    const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
    const prev = el.imageProfileSelect.value;
    el.imageProfileSelect.innerHTML = '';
    for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        el.imageProfileSelect.appendChild(opt);
    }
    // Preserve selection if still valid, otherwise default to first
    if (names.includes(prev)) {
        el.imageProfileSelect.value = prev;
    }
    imageSelectUI.refresh();
}

function loadProfileIntoUI(name) {
    if (!name) return;
    const profiles = loadProfiles();
    const p = profiles[name];
    if (!p) return;
    if (p.seed) el.seed.value = p.seed;
    el.note.value = p.note || '';
    if (p.aspects) {
        for (const [key, val] of Object.entries(p.aspects)) {
            if (el[key]) el[key].value = val;
        }
    }
    el.profileName.value = name;
    loadedProfileName = name;
    updateAspectLabels(readAspectsFromUI());
}

function setStillRendered(value) {
    stillRendered = value;
    el.exportBtn.disabled = !value;
}

function clearStillText() {
    if (typewriterAbort) { typewriterAbort(); typewriterAbort = null; }
    el.titleText.textContent = '';
    el.altText.textContent = '';
    hideCanvasOverlay();
}

/* Canvas overlay helpers */
function showCanvasOverlay(text, showSpinner = false) {
    el.canvasOverlayText.textContent = text;
    el.canvasOverlay.classList.remove('hidden');
    if (showSpinner) {
        loadingAnim.start();
    } else {
        loadingAnim.stop();
    }
}

function hideCanvasOverlay() {
    el.canvasOverlay.classList.add('hidden');
    loadingAnim.stop();
}

/* Typewriter effect */
let typewriterAbort = null;

function typewriterEffect(element, text, charDelayMs, onComplete) {
    let i = 0;
    let cancelled = false;
    const textNode = document.createTextNode('');
    const cursor = document.createElement('span');
    cursor.className = 'tw-cursor';
    element.textContent = '';
    element.appendChild(textNode);
    element.appendChild(cursor);

    function tick() {
        if (cancelled) { cursor.remove(); return; }
        if (i <= text.length) {
            textNode.textContent = text.slice(0, i);
            i++;
            setTimeout(tick, charDelayMs);
        } else {
            cursor.remove();
            if (onComplete) onComplete();
        }
    }
    tick();
    return () => { cancelled = true; cursor.remove(); };
}

function playRevealAnimation(titleText, altText) {
    // Cancel any in-progress typewriter
    if (typewriterAbort) { typewriterAbort(); typewriterAbort = null; }

    // Clear text areas
    el.titleText.textContent = '';
    el.altText.textContent = '';

    // 1. Typewriter title
    const cancelTitle = typewriterEffect(el.titleText, titleText, 30, () => {
        // 2. Reveal canvas — hide overlay + wipe
        hideCanvasOverlay();
        const wrapper = document.querySelector('.canvas-wrapper');
        const wipe = document.createElement('div');
        wipe.className = 'reveal-wipe';
        wrapper.appendChild(wipe);
        wipe.addEventListener('animationend', () => wipe.remove());

        // 3. Typewriter alt text (below the image, after reveal)
        const cancelAlt = typewriterEffect(el.altText, altText, 8, () => {
            typewriterAbort = null;
        });
        typewriterAbort = cancelAlt;
    });
    typewriterAbort = cancelTitle;
}

/** Render + update DOM title/alt. */
function renderAndUpdate(seed, aspects, { animate = false } = {}) {
    if (animate) {
        // Hide canvas behind overlay before rendering new content
        el.canvasOverlay.classList.remove('hidden');
        loadingAnim.stop();
        el.canvasOverlayText.textContent = '';
    }
    const meta = renderer.renderWith(seed, aspects);
    if (animate) {
        playRevealAnimation(meta.title, meta.altText);
    } else {
        el.titleText.textContent = meta.title;
        el.altText.textContent = meta.altText;
    }
    return meta;
}

function getLandmarkAspectsOrdered() {
    const profiles = loadProfiles();
    const arr = [];
    for (const name of loopLandmarks) {
        const p = profiles[name];
        if (p?.aspects) arr.push({ name, ...p });
    }
    return arr;
}

function deriveAnimSeed() {
    const landmarks = getLandmarkAspectsOrdered();
    if (landmarks.length === 0) return 'anim-seed';
    const combined = landmarks.map(l => l.seed || l.name).join('::');
    return 'anim::' + combined;
}

function refreshLoopList() {
    const profiles = loadProfiles();
    renderLoopList(el.loopList, loopLandmarks, profiles, {
        onReorder(newLandmarks) {
            loopLandmarks = newLandmarks;
            invalidateFrameBuffer();
            refreshLoopList();
        },
        onRemove(idx) {
            loopLandmarks.splice(idx, 1);
            invalidateFrameBuffer();
            refreshLoopList();
        },
    }, queueThumbnail);
}

/* ---------------------------
 * Animation controller
 * ---------------------------
 */
const animController = createAnimationController({
    drawFrame(bitmap) {
        ctx.drawImage(bitmap, 0, 0);
    },
    onFrame(tNorm) {
        el.progressBar.style.width = `${(tNorm * 100).toFixed(2)}%`;
    },
    onPlayStateChange() {},
});

/* ---------------------------
 * Duration slider
 * ---------------------------
 */
el.loopDuration.addEventListener('input', () => {
    const secs = parseInt(el.loopDuration.value, 10);
    loopDurationMs = secs * 1000;
    el.durationLabel.textContent = `${secs}s`;
    invalidateFrameBuffer();
});

/* ---------------------------
 * Mode switching
 * ---------------------------
 */
function setMode(mode) {
    currentMode = mode;

    // Toggle pillbar
    el.modeImage.classList.toggle('active', mode === 'image');
    el.modeAnim.classList.toggle('active', mode === 'anim');

    // Toggle sections with mode-enter animation
    const enterSection = mode === 'image' ? el.imageSection : el.animSection;
    const leaveSection = mode === 'image' ? el.animSection : el.imageSection;
    leaveSection.classList.add('hidden');
    enterSection.classList.remove('hidden');
    enterSection.classList.add('mode-enter');
    enterSection.addEventListener('animationend', () => {
        enterSection.classList.remove('mode-enter');
    }, { once: true });

    if (mode === 'image') {
        el.progressContainer.classList.add('hidden');
        hideCanvasOverlay();
        animController.stop();
        motionBlur.setEnabled(false);
        motionBlur.clear();
        renderStillCanvas();
        clearStillText();
        setStillRendered(false);
        el.renderBtn.textContent = 'Render';
        el.renderBtn.disabled = false;
    } else {
        el.progressContainer.classList.remove('hidden');
        motionBlur.setEnabled(MOTION_BLUR_ENABLED);
        motionBlur.clear();

        refreshProfileSelect(el.profileSelect); animSelectUI.refresh();
        refreshLoopList();

        if (frameBuffer.rendered) {
            hideCanvasOverlay();
            if (frameBuffer.frames.length > 0) {
                ctx.drawImage(frameBuffer.frames[0], 0, 0);
            }
            el.renderBtn.textContent = 'Re-render';
            el.exportBtn.disabled = false;
            animController.playFromBuffer(frameBuffer.frames, frameBuffer.durationMs);
        } else {
            showCanvasOverlay('Render to preview');
            el.titleText.textContent = '';
            el.altText.textContent = '';
            el.renderBtn.textContent = 'Render';
            el.exportBtn.disabled = true;
        }
    }
    // Toggle save buttons
    el.saveProfile.classList.toggle('hidden', mode !== 'image');
    el.saveAnimProfile.classList.toggle('hidden', mode !== 'anim');

    refreshProfileGallery();
}

el.modeImage.addEventListener('click', () => setMode('image'));
el.modeAnim.addEventListener('click', () => setMode('anim'));

/* ---------------------------
 * Image mode
 * ---------------------------
 */
/** Render canvas only (no title/alt-text). For live slider preview. */
function renderStillCanvas() {
    const seed = el.seed.value.trim() || 'seed';
    const aspects = readAspectsFromUI();
    updateAspectLabels(aspects);
    renderer.renderWith(seed, aspects);
}

el.renderBtn.addEventListener('click', async () => {
    if (currentMode === 'image') {
        const seed = el.seed.value.trim() || 'seed';
        const aspects = readAspectsFromUI();
        updateAspectLabels(aspects);
        renderAndUpdate(seed, aspects, { animate: true });
        setStillRendered(true);
        toast('Rendered.');
    } else {
        // Animation render
        const landmarks = getLandmarkAspectsOrdered();
        if (landmarks.length < 2) { toast('Add 2+ landmarks.'); return; }

        animController.stop();
        invalidateFrameBuffer();

        frameBuffer.rendering = true;
        el.renderBtn.disabled = true;
        el.renderBtn.textContent = 'Rendering\u2026';
        el.exportBtn.disabled = true;

        showCanvasOverlay('Rendering\u2026', true);

        const seed = deriveAnimSeed();

        try {
            const frames = await preRenderFrames({
                canvas,
                renderer,
                motionBlur,
                landmarks,
                seed,
                durationMs: loopDurationMs,
                fps: ANIM_FPS,
                onProgress(done, total) {
                    el.progressBar.style.width = `${((done / total) * 100).toFixed(1)}%`;
                },
                isCancelled() { return !frameBuffer.rendering; },
            });

            if (!frames) {
                showCanvasOverlay('Render to preview');
                toast('Render cancelled.');
                return;
            }

            frameBuffer.frames = frames;
            frameBuffer.rendered = true;
            frameBuffer.durationMs = loopDurationMs;
            frameBuffer.seed = seed;

            el.exportBtn.disabled = false;
            el.renderBtn.textContent = 'Re-render';

            if (frames.length > 0) {
                ctx.drawImage(frames[0], 0, 0);
            }

            const summary = computeLoopSummaryTitleAlt(seed, landmarks, loopDurationMs / 1000);
            playRevealAnimation(summary.title, summary.altText);

            // Auto-play
            animController.playFromBuffer(frames, loopDurationMs);

            toast(`Rendered ${frames.length} frames.`);
        } catch (err) {
            console.error(err);
            showCanvasOverlay('Render to preview');
            toast('Render failed.');
        } finally {
            frameBuffer.rendering = false;
            el.renderBtn.disabled = false;
        }
    }
});

for (const id of ['coherence', 'tension', 'recursion', 'motion', 'vulnerability', 'radiance']) {
    el[id].addEventListener('input', () => {
        renderStillCanvas();
        clearStillText();
        setStillRendered(false);
    });
}
el.seed.addEventListener('change', () => {
    renderStillCanvas();
    clearStillText();
    setStillRendered(false);
});

el.imageProfileSelect.addEventListener('change', () => {
    const name = el.imageProfileSelect.value;
    if (!name) return;
    loadProfileIntoUI(name);
    const seed = el.seed.value.trim() || 'seed';
    const aspects = readAspectsFromUI();
    renderAndUpdate(seed, aspects, { animate: true });
    setStillRendered(true);
    updateActiveProfileIndicator();
});

el.saveProfile.addEventListener('click', () => {
    const name = (el.profileName.value || '').trim();
    if (!name) { toast('Give the profile a name.'); return; }

    const profiles = loadProfiles();
    profiles[name] = {
        seed: el.seed.value.trim() || 'seed',
        note: readNote(),
        aspects: readAspectsFromUI(),
    };
    saveProfiles(profiles);
    refreshProfileSelect(el.profileSelect); animSelectUI.refresh();
    refreshImageProfileSelect();
    refreshProfileGallery();
    refreshAnimProfileGallery();
    toast(`Saved profile: ${name}`);
});

el.saveAnimProfile.addEventListener('click', () => {
    const name = (el.animProfileName.value || '').trim();
    if (!name) { toast('Give the animation profile a name.'); return; }
    if (loopLandmarks.length < 2) { toast('Add 2+ landmarks to save.'); return; }

    const animProfiles = loadAnimProfiles();
    animProfiles[name] = {
        landmarks: [...loopLandmarks],
        durationMs: loopDurationMs,
        note: (el.animNote.value || '').trim(),
    };
    saveAnimProfiles(animProfiles);
    refreshAnimProfileGallery();
    toast(`Saved animation: ${name}`);
});

/* ---------------------------
 * Randomize
 * ---------------------------
 */
el.randomize.addEventListener('click', () => {
    const adj = ['Quiet', 'Tender', 'Fractured', 'Luminous', 'Drifting', 'Folded', 'Still', 'Soft', 'Deep', 'Woven', 'Dim', 'Pale', 'Curved', 'Warm', 'Fading', 'Open', 'Calm', 'Bright', 'Layered', 'Slow'];
    const noun = ['Axis', 'Drift', 'Field', 'Interior', 'Lattice', 'Membrane', 'Pulse', 'Residue', 'Signal', 'Threshold', 'Veil', 'Geometry', 'Haze', 'Arc', 'Fold', 'Bloom', 'Edge', 'Glow', 'Lumen', 'Trace'];
    el.profileName.value = adj[Math.floor(Math.random() * adj.length)] + ' ' + noun[Math.floor(Math.random() * noun.length)];
    el.seed.value = Math.random().toString(36).slice(2, 10);
    for (const id of ['coherence', 'tension', 'recursion', 'motion', 'vulnerability', 'radiance']) {
        el[id].value = Math.random().toFixed(2);
    }
    const seed = el.seed.value.trim() || 'seed';
    const aspects = readAspectsFromUI();
    updateAspectLabels(aspects);
    renderAndUpdate(seed, aspects, { animate: true });
    setStillRendered(true);
    toast('Randomized.');
});

/* ---------------------------
 * Profile gallery (shared, mode-aware)
 * ---------------------------
 */
const TRASH_SVG = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0v-6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>';

function refreshProfileGallery() {
    const profiles = loadProfiles();
    const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
    el.profileGallery.innerHTML = '';

    if (names.length === 0) {
        const d = document.createElement('div');
        d.className = 'small';
        d.textContent = 'No saved profiles yet.';
        el.profileGallery.appendChild(d);
        return;
    }

    for (const name of names) {
        const p = profiles[name];
        const card = document.createElement('div');
        card.className = 'profile-card';
        card.dataset.profileName = name;

        // Active profile indicator
        if (name === loadedProfileName && currentMode === 'image') {
            card.classList.add('active-profile');
        }

        // Click anywhere on card to expand/collapse
        card.addEventListener('click', () => {
            card.classList.toggle('expanded');
        });

        // Thumbnail
        const thumbImg = document.createElement('img');
        thumbImg.className = 'profile-thumb';
        card.appendChild(thumbImg);
        if (p.seed && p.aspects) {
            queueThumbnail(p.seed, { ...p.aspects }, thumbImg);
        }

        // Body
        const body = document.createElement('div');
        body.className = 'profile-card-body';

        const nm = document.createElement('div');
        nm.className = 'profile-card-name';
        nm.textContent = name;
        body.appendChild(nm);

        const actions = document.createElement('div');
        actions.className = 'profile-card-actions';

        // Contextual action button
        const actionBtn = document.createElement('button');
        if (currentMode === 'image') {
            actionBtn.textContent = 'Load';
            actionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                loadProfileIntoUI(name);
                el.imageProfileSelect.value = name;
                imageSelectUI.refresh();
                const seed = el.seed.value.trim() || 'seed';
                const aspects = readAspectsFromUI();
                renderAndUpdate(seed, aspects, { animate: true });
                setStillRendered(true);
                updateActiveProfileIndicator();
                toast(`Loaded: ${name}`);
            });
        } else {
            actionBtn.textContent = 'Add';
            actionBtn.classList.add('primary');
            actionBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                loopLandmarks.push(name);
                invalidateFrameBuffer();
                refreshLoopList();
                toast(`Added: ${name}`);
            });
        }

        actions.appendChild(actionBtn);
        body.appendChild(actions);
        card.appendChild(body);

        // Expandable details section (structured dl grid)
        const details = document.createElement('div');
        details.className = 'profile-card-details';

        const dl = document.createElement('dl');
        const addRow = (label, value) => {
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.textContent = value;
            dl.appendChild(dt);
            dl.appendChild(dd);
        };

        addRow('Seed', p.seed || '\u2014');
        if (p.aspects) {
            const a = p.aspects;
            addRow('Coherence', a.coherence.toFixed(2));
            addRow('Tension', a.tension.toFixed(2));
            addRow('Recursion', a.recursion.toFixed(2));
            addRow('Motion', a.motion.toFixed(2));
            addRow('Vulnerability', a.vulnerability.toFixed(2));
            addRow('Radiance', a.radiance.toFixed(2));
        }
        details.appendChild(dl);

        if (p.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'detail-note';
            noteEl.textContent = p.note;
            details.appendChild(noteEl);
        }

        card.appendChild(details);

        // Chevron indicator (decorative, below delete button)
        const chevron = document.createElement('span');
        chevron.className = 'profile-card-chevron';
        chevron.textContent = '\u25be';
        card.appendChild(chevron);

        // Delete button (trashcan icon, upper-right)
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'profile-card-delete';
        deleteBtn.title = 'Delete';
        deleteBtn.innerHTML = TRASH_SVG;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const refs = findAnimProfilesReferencingImage(name);
            if (refs.length > 0) {
                const animNames = refs.map(r => r.animName).join('\n  - ');
                const msg = `"${name}" is used by:\n  - ${animNames}\n\n` +
                            `Deleting will remove it from those animation profiles. Continue?`;
                if (!confirm(msg)) return;
                removeImageFromAnimProfiles(name);
            }
            deleteProfile(name);
            refreshProfileSelect(el.profileSelect); animSelectUI.refresh();
            refreshImageProfileSelect();
            refreshProfileGallery();
            refreshAnimProfileGallery();
            toast(`Deleted: ${name}`);
        });
        card.appendChild(deleteBtn);

        el.profileGallery.appendChild(card);
    }
}

/* Targeted active-profile indicator update (avoids full gallery rebuild) */
function updateActiveProfileIndicator() {
    const cards = el.profileGallery.querySelectorAll('.profile-card');
    cards.forEach(card => {
        const isActive = card.dataset.profileName === loadedProfileName && currentMode === 'image';
        card.classList.toggle('active-profile', isActive);
    });
}

/* ---------------------------
 * Animation profile gallery
 * ---------------------------
 */
function refreshAnimProfileGallery() {
    const animProfiles = loadAnimProfiles();
    const imageProfiles = loadProfiles();
    const names = Object.keys(animProfiles).sort((a, b) => a.localeCompare(b));
    el.animProfileGallery.innerHTML = '';

    if (names.length === 0) {
        const d = document.createElement('div');
        d.className = 'small';
        d.textContent = 'No saved animation profiles yet.';
        el.animProfileGallery.appendChild(d);
        return;
    }

    for (const name of names) {
        const ap = animProfiles[name];
        const card = document.createElement('div');
        card.className = 'profile-card';
        card.dataset.animProfileName = name;

        card.addEventListener('click', () => {
            card.classList.toggle('expanded');
        });

        // Thumbnail: first landmark's image
        const thumbImg = document.createElement('img');
        thumbImg.className = 'profile-thumb';
        card.appendChild(thumbImg);
        const firstLandmark = ap.landmarks[0];
        const fp = imageProfiles[firstLandmark];
        if (fp?.seed && fp?.aspects) {
            queueThumbnail(fp.seed, { ...fp.aspects }, thumbImg);
        }

        // Body
        const body = document.createElement('div');
        body.className = 'profile-card-body';

        const nm = document.createElement('div');
        nm.className = 'profile-card-name';
        nm.textContent = name;
        body.appendChild(nm);

        // Meta line
        const meta = document.createElement('div');
        meta.className = 'anim-card-meta';
        const validCount = ap.landmarks.filter(n => imageProfiles[n]).length;
        meta.textContent = `${validCount} landmark${validCount !== 1 ? 's' : ''} \u00b7 ${Math.round(ap.durationMs / 1000)}s`;
        body.appendChild(meta);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'profile-card-actions';

        const actionBtn = document.createElement('button');
        actionBtn.textContent = 'Load';
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setMode('anim');
            loopLandmarks = [...ap.landmarks];
            loopDurationMs = ap.durationMs;
            const secs = Math.round(ap.durationMs / 1000);
            el.loopDuration.value = secs;
            el.durationLabel.textContent = `${secs}s`;
            el.animProfileName.value = name;
            el.animNote.value = ap.note || '';
            invalidateFrameBuffer();
            refreshLoopList();
            toast(`Loaded animation: ${name}`);
        });

        actions.appendChild(actionBtn);
        body.appendChild(actions);
        card.appendChild(body);

        // Expandable details
        const details = document.createElement('div');
        details.className = 'profile-card-details';

        const dl = document.createElement('dl');
        const addRow = (label, value) => {
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.textContent = value;
            dl.appendChild(dt);
            dl.appendChild(dd);
        };

        addRow('Duration', `${Math.round(ap.durationMs / 1000)}s`);
        addRow('Landmarks', ap.landmarks.length.toString());
        for (let i = 0; i < ap.landmarks.length; i++) {
            const lName = ap.landmarks[i];
            const exists = !!imageProfiles[lName];
            addRow(`  ${i + 1}.`, exists ? lName : `${lName} (missing)`);
        }
        details.appendChild(dl);

        if (ap.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'detail-note';
            noteEl.textContent = ap.note;
            details.appendChild(noteEl);
        }

        card.appendChild(details);

        // Chevron
        const chevron = document.createElement('span');
        chevron.className = 'profile-card-chevron';
        chevron.textContent = '\u25be';
        card.appendChild(chevron);

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'profile-card-delete';
        deleteBtn.title = 'Delete';
        deleteBtn.innerHTML = TRASH_SVG;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteAnimProfile(name);
            refreshAnimProfileGallery();
            toast(`Deleted animation: ${name}`);
        });
        card.appendChild(deleteBtn);

        el.animProfileGallery.appendChild(card);
    }
}

/* ---------------------------
 * Animation mode controls
 * ---------------------------
 */
el.addToLoop.addEventListener('click', () => {
    const name = el.profileSelect.value;
    if (!name) { toast('Select a profile.'); return; }
    loopLandmarks.push(name);
    invalidateFrameBuffer();
    refreshLoopList();
    toast(`Added: ${name}`);
});

el.clearLoop.addEventListener('click', () => {
    loopLandmarks = [];
    invalidateFrameBuffer();
    refreshLoopList();
    motionBlur.clear();
    toast('Cleared.');
});


/* ---------------------------
 * Export (unified)
 * ---------------------------
 */
el.exportBtn.addEventListener('click', async () => {
    if (currentMode === 'image') {
        if (!stillRendered) { toast('Render first.'); return; }
        if (!window.JSZip) { toast('JSZip missing (offline?).'); return; }

        const seed = el.seed.value.trim() || 'seed';
        const aspects = readAspectsFromUI();
        const note = readNote();

        motionBlur.setEnabled(false);
        motionBlur.clear();

        const meta = renderAndUpdate(seed, aspects);

        try {
            await packageStillZip(canvas, { seed, aspects, note, meta });
            toast('Exported still ZIP.');
        } catch (err) {
            console.error(err);
            toast('Still export failed.');
        }
    } else {
        if (!window.JSZip) { toast('JSZip missing (offline?).'); return; }
        if (!frameBuffer.rendered || frameBuffer.frames.length === 0) {
            toast('Render the animation first.');
            return;
        }

        animController.stop();

        const seed = frameBuffer.seed;
        const landmarks = getLandmarkAspectsOrdered();

        try {
            toast('Encoding animation...');
            el.exportBtn.disabled = true;

            const rec = await exportFromBuffer({
                frames: frameBuffer.frames,
                fps: ANIM_FPS,
                durationMs: frameBuffer.durationMs,
                seed,
                canvas,
                onProgress(tNorm) {
                    el.progressBar.style.width = `${(tNorm * 100).toFixed(2)}%`;
                },
            });

            await packageAnimZip(rec, {
                landmarks,
                loopLandmarkNames: loopLandmarks,
                timeWarpStrength: TIME_WARP_STRENGTH,
            });

            toast(rec.kind === 'video' ? 'Exported animation MP4.' : 'Exported animation frames.');
        } catch (err) {
            console.error(err);
            toast('Animation export failed.');
        } finally {
            el.exportBtn.disabled = false;
        }
    }
});

/* ---------------------------
 * Statement modal (Developer / Artist)
 * ---------------------------
 */
const STATEMENT_TITLES = { developer: '', artist: '' };

async function loadStatementContent() {
    const files = {
        developerTitle: 'txt/developer-statement-title.txt',
        artistTitle: 'txt/artist-statement-title.txt',
        developerContent: 'txt/developer-statement-content.txt',
        artistContent: 'txt/artist-statement-content.txt',
    };
    try {
        const [devTitle, artTitle, devContent, artContent] = await Promise.all(
            Object.values(files).map(f => fetch(f).then(r => r.text()))
        );
        STATEMENT_TITLES.developer = devTitle.trim();
        STATEMENT_TITLES.artist = artTitle.trim();
        el.developerBody.querySelector('.manifesto').textContent = devContent.trim();
        el.artistBody.querySelector('.manifesto').textContent = artContent.trim();
    } catch (err) {
        console.error('Failed to load statement content:', err);
    }
}

let statementContentReady = null;
let statementFlipping = false;

let statementClosing = false;

async function openStatementModal(tab) {
    if (statementClosing) return;
    if (statementContentReady) await statementContentReady;
    el.statementModal.classList.remove('hidden');
    el.statementModal.classList.remove('modal-leaving');
    el.statementModal.classList.add('modal-entering');
    const box = el.statementModal.querySelector('.modal-box');
    box.addEventListener('animationend', () => {
        el.statementModal.classList.remove('modal-entering');
    }, { once: true });
    switchStatementTab(tab, false);
}

function closeStatementModal() {
    if (statementClosing) return;
    statementClosing = true;
    statementFlipping = false;
    el.statementModal.classList.remove('modal-entering');
    el.statementModal.classList.add('modal-leaving');
    const box = el.statementModal.querySelector('.modal-box');
    box.addEventListener('animationend', () => {
        el.statementModal.classList.add('hidden');
        el.statementModal.classList.remove('modal-leaving');
        statementClosing = false;
    }, { once: true });
}

function switchStatementTab(tab, animate = true) {
    const currentTab = el.developerBody.classList.contains('hidden') ? 'artist' : 'developer';

    // Update tab buttons immediately
    el.statementModal.querySelectorAll('.modal-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    if (!animate || currentTab === tab || statementFlipping) {
        // Instant switch (no animation)
        el.statementTitle.textContent = STATEMENT_TITLES[tab] || '';
        el.developerBody.classList.toggle('hidden', tab !== 'developer');
        el.artistBody.classList.toggle('hidden', tab !== 'artist');
        return;
    }

    statementFlipping = true;
    const outgoing = currentTab === 'developer' ? el.developerBody : el.artistBody;
    const incoming = tab === 'developer' ? el.developerBody : el.artistBody;
    const FLIP_OUT_MS = 300;

    // Phase 1: flip out current content + title
    outgoing.classList.add('coin-flip-out');
    el.statementTitle.classList.add('coin-flip-out');

    setTimeout(() => {
        // Swap at the midpoint (edge-on)
        outgoing.classList.remove('coin-flip-out');
        outgoing.classList.add('hidden');

        el.statementTitle.classList.remove('coin-flip-out');
        el.statementTitle.textContent = STATEMENT_TITLES[tab] || '';

        // Phase 2: flip in new content + title
        incoming.classList.remove('hidden');
        incoming.classList.add('coin-flip-in');
        el.statementTitle.classList.add('coin-flip-in');

        // Scroll back to top
        el.statementModal.querySelector('.modal-body').scrollTop = 0;

        const cleanup = () => {
            incoming.classList.remove('coin-flip-in');
            el.statementTitle.classList.remove('coin-flip-in');
            statementFlipping = false;
        };
        incoming.addEventListener('animationend', cleanup, { once: true });
    }, FLIP_OUT_MS);
}

el.developerStatement.addEventListener('click', () => openStatementModal('developer'));
el.artistStatement.addEventListener('click', () => openStatementModal('artist'));
el.statementModalClose.addEventListener('click', closeStatementModal);
el.statementModal.addEventListener('click', (e) => {
    if (e.target === el.statementModal) closeStatementModal();
    const tab = e.target.closest('.modal-tab');
    if (tab) switchStatementTab(tab.dataset.tab);
});

/* ---------------------------
 * Info modal (aspect descriptions)
 * ---------------------------
 */
function openInfoModal(title, body) {
    el.infoModalTitle.textContent = title;
    el.infoModalBody.textContent = body;
    el.infoModal.classList.remove('hidden');
}

function closeInfoModal() {
    el.infoModal.classList.add('hidden');
}

el.infoModalClose.addEventListener('click', closeInfoModal);
el.infoModal.addEventListener('click', (e) => {
    if (e.target === el.infoModal) closeInfoModal();
});

document.addEventListener('click', (e) => {
    const labelInfo = e.target.closest('.label-info');
    if (labelInfo) {
        const title = labelInfo.getAttribute('data-label') || '';
        const body = labelInfo.getAttribute('data-tooltip') || '';
        openInfoModal(title, body);
    }
});

/* Escape key — close whichever modal is open */
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el.infoModal.classList.contains('hidden')) {
        closeInfoModal();
    } else if (!el.statementModal.classList.contains('hidden')) {
        closeStatementModal();
    }
});

/* ---------------------------
 * Collapsible sections
 * ---------------------------
 */
document.querySelectorAll('.collapsible-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        document.getElementById(btn.dataset.target)
            .classList.toggle('collapsed', expanded);
    });
});

document.querySelectorAll('.sub-collapsible-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        document.getElementById(btn.dataset.target)
            .classList.toggle('collapsed', expanded);
    });
});

// Menus default to collapsed in HTML; expand on wide viewports
if (window.innerWidth > 767) {
    document.querySelectorAll('.collapsible-toggle').forEach(btn => {
        const content = document.getElementById(btn.dataset.target);
        content.classList.add('no-transition');
        btn.setAttribute('aria-expanded', 'true');
        content.classList.remove('collapsed');
        content.offsetHeight; // force reflow
        content.classList.remove('no-transition');
    });
}

/* ---------------------------
 * Init
 * ---------------------------
 */
initTheme(document.getElementById('themeSwitcher'));
statementContentReady = loadStatementContent();
ensureStarterProfiles();
refreshProfileSelect(el.profileSelect); animSelectUI.refresh();
refreshImageProfileSelect();

// Load profile first so gallery can show active indicator
loadProfileIntoUI(el.imageProfileSelect.value);
updateAspectLabels(readAspectsFromUI());

setMode('image');

// Start loading animation immediately — defer all heavy work so it gets
// clean rAF frames before any thumbnail renders block the main thread.
showCanvasOverlay('', true);

requestAnimationFrame(() => {
    // Gallery builds DOM + queues staggered thumbnail renders (via cache/queue)
    refreshProfileGallery();
    refreshAnimProfileGallery();
    refreshLoopList();

    // Let the loading animation play smoothly, then render the main image
    setTimeout(() => {
        const seed = el.seed.value.trim() || 'seed';
        const aspects = readAspectsFromUI();
        renderAndUpdate(seed, aspects, { animate: true });
        setStillRendered(true);
    }, 600);
});
