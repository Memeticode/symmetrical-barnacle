/**
 * Entry point — wires all modules to the DOM.
 */

import { createRenderer } from './renderer.js';
import { createMotionBlur } from './motion-blur.js';
import { evalAspectsAt, TIME_WARP_STRENGTH } from './interpolation.js';
import { loadProfiles, saveProfiles, refreshProfileSelect, ensureStarterProfiles, renderLoopList } from './profiles.js';
import { createAnimationController, exportAnimation, ANIM_FPS, MOTION_BLUR_ENABLED, MB_DECAY, MB_ADD } from './animation.js';
import { packageStillZip, packageAnimZip } from './export.js';

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
    animSeed: document.getElementById('animSeed'),

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
    renderStill: document.getElementById('renderStill'),
    exportStillZip: document.getElementById('exportStillZip'),

    profileSelect: document.getElementById('profileSelect'),
    addToLoop: document.getElementById('addToLoop'),
    clearLoop: document.getElementById('clearLoop'),
    loadDemoLoop: document.getElementById('loadDemoLoop'),
    loopList: document.getElementById('loopList'),
    playPause: document.getElementById('playPause'),
    exportAnimZip: document.getElementById('exportAnimZip'),
    progressBar: document.getElementById('progressBar'),

    loopDuration: document.getElementById('loopDuration'),
    durationLabel: document.getElementById('durationLabel'),

    titleText: document.getElementById('titleText'),
    altText: document.getElementById('altText'),
    toast: document.getElementById('toast'),
};

/* ---------------------------
 * Module instances
 * ---------------------------
 */
const renderer = createRenderer(canvas, ctx);
const motionBlur = createMotionBlur(canvas, ctx, { decay: MB_DECAY, add: MB_ADD });

/* ---------------------------
 * State
 * ---------------------------
 */
let loopLandmarks = [];
let loopDurationMs = 30_000;

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

/** Render + update DOM title/alt. */
function renderAndUpdate(seed, aspects) {
    const meta = renderer.renderWith(seed, aspects);
    el.titleText.textContent = meta.title;
    el.altText.textContent = meta.altText;
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

function refreshLoopList() {
    const profiles = loadProfiles();
    renderLoopList(el.loopList, loopLandmarks, profiles, {
        onReorder(newLandmarks) {
            loopLandmarks = newLandmarks;
            refreshLoopList();
        },
        onRemove(idx) {
            loopLandmarks.splice(idx, 1);
            refreshLoopList();
        },
    });
}

/* ---------------------------
 * Animation controller
 * ---------------------------
 */
const animController = createAnimationController({
    renderer,
    motionBlur,
    getLandmarks: getLandmarkAspectsOrdered,
    getAnimSeed: () => el.animSeed.value.trim() || 'anim-seed',
    getLoopDurationMs: () => loopDurationMs,
    onFrame(tNorm, meta) {
        el.progressBar.style.width = `${(tNorm * 100).toFixed(2)}%`;
        el.titleText.textContent = meta.title;
        el.altText.textContent = meta.altText;
    },
    onPlayStateChange(playing) {
        el.playPause.textContent = playing ? 'Pause' : 'Play';
    },
});

/* ---------------------------
 * Duration slider
 * ---------------------------
 */
el.loopDuration.addEventListener('input', () => {
    const secs = parseInt(el.loopDuration.value, 10);
    loopDurationMs = secs * 1000;
    el.durationLabel.textContent = `${secs}s`;
});

/* ---------------------------
 * Mode switching
 * ---------------------------
 */
function setMode(mode) {
    if (mode === 'image') {
        el.modeImage.classList.add('active');
        el.modeAnim.classList.remove('active');
        el.imageSection.classList.remove('hidden');
        el.animSection.classList.add('hidden');

        animController.stop();
        motionBlur.setEnabled(false);
        motionBlur.clear();
        renderStill();
    } else {
        el.modeAnim.classList.add('active');
        el.modeImage.classList.remove('active');
        el.animSection.classList.remove('hidden');
        el.imageSection.classList.add('hidden');

        motionBlur.setEnabled(MOTION_BLUR_ENABLED);
        motionBlur.clear();

        refreshProfileSelect(el.profileSelect);
        refreshLoopList();

        const landmarks = getLandmarkAspectsOrdered();
        if (landmarks.length >= 2) {
            const aspects = evalAspectsAt(0.0, landmarks);
            renderAndUpdate(el.animSeed.value.trim() || 'anim-seed', aspects);
            motionBlur.apply();
        }
    }
}

el.modeImage.addEventListener('click', () => setMode('image'));
el.modeAnim.addEventListener('click', () => setMode('anim'));

/* ---------------------------
 * Image mode
 * ---------------------------
 */
function renderStill() {
    const seed = el.seed.value.trim() || 'seed';
    const aspects = readAspectsFromUI();
    updateAspectLabels(aspects);
    return renderAndUpdate(seed, aspects);
}

el.renderStill.addEventListener('click', () => {
    renderStill();
    toast('Rendered.');
});

for (const id of ['coherence', 'tension', 'recursion', 'motion', 'vulnerability', 'radiance']) {
    el[id].addEventListener('input', () => renderStill());
}
el.seed.addEventListener('change', () => renderStill());

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
    refreshProfileSelect(el.profileSelect);
    toast(`Saved profile: ${name}`);
});

/* ---------------------------
 * Animation mode controls
 * ---------------------------
 */
el.addToLoop.addEventListener('click', () => {
    const name = el.profileSelect.value;
    if (!name) { toast('Select a profile.'); return; }
    loopLandmarks.push(name);
    refreshLoopList();
    toast(`Added: ${name}`);
});

el.clearLoop.addEventListener('click', () => {
    loopLandmarks = [];
    refreshLoopList();
    el.progressBar.style.width = '0%';
    motionBlur.clear();
    toast('Cleared.');
});

el.loadDemoLoop.addEventListener('click', () => {
    loopLandmarks = [
        'Calm Axis (Starter)',
        'Quietly Bent (Starter)',
        'Night Drift (Starter)',
        'Tender Permeability (Starter)',
    ];
    refreshLoopList();
    el.animSeed.value = 'demo-unified-seed-001';
    motionBlur.clear();
    toast('Loaded demo loop.');
});

el.playPause.addEventListener('click', () => {
    const landmarks = getLandmarkAspectsOrdered();
    if (landmarks.length < 2) { toast('Add 2+ landmarks.'); return; }

    if (animController.isPlaying()) {
        animController.pause();
    } else {
        el.progressBar.style.width = '0%';
        animController.play();
    }
});

/* ---------------------------
 * Exports
 * ---------------------------
 */
el.exportStillZip.addEventListener('click', async () => {
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
});

el.exportAnimZip.addEventListener('click', async () => {
    if (!window.JSZip) { toast('JSZip missing (offline?).'); return; }

    const landmarks = getLandmarkAspectsOrdered();
    if (landmarks.length < 2) { toast('Add 2+ landmarks.'); return; }

    // Stop playback during export
    animController.stop();

    const seed = el.animSeed.value.trim() || 'anim-seed';

    try {
        toast('Rendering animation...');
        el.exportAnimZip.disabled = true;

        const rec = await exportAnimation({
            canvas,
            renderer,
            motionBlur,
            landmarks,
            seed,
            durationMs: loopDurationMs,
            fps: ANIM_FPS,
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
        el.exportAnimZip.disabled = false;
    }
});

/* ---------------------------
 * Init
 * ---------------------------
 */
ensureStarterProfiles();
refreshProfileSelect(el.profileSelect);
updateAspectLabels(readAspectsFromUI());
renderStill();
refreshLoopList();
setMode('image');
