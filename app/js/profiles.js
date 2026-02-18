/**
 * Profile storage (localStorage) and loop list UI rendering.
 */

const LS_KEY = 'geo_self_portrait_profiles_v3';
const ANIM_LS_KEY = 'geo_self_portrait_anim_profiles_v1';

/* ---------------------------
 * Image profile CRUD
 * ---------------------------
 */

export function loadProfiles() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed;
    } catch {
        return {};
    }
}

export function saveProfiles(profiles) {
    localStorage.setItem(LS_KEY, JSON.stringify(profiles, null, 2));
}

export function deleteProfile(name) {
    const profiles = loadProfiles();
    delete profiles[name];
    saveProfiles(profiles);
}

export function refreshProfileSelect(selectEl) {
    const profiles = loadProfiles();
    const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));

    selectEl.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = names.length ? '— Select a saved profile —' : '— No profiles yet —';
    selectEl.appendChild(empty);

    for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        selectEl.appendChild(opt);
    }
}

/* ---------------------------
 * Animation profile CRUD
 * ---------------------------
 */

export function loadAnimProfiles() {
    try {
        const raw = localStorage.getItem(ANIM_LS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed;
    } catch {
        return {};
    }
}

export function saveAnimProfiles(profiles) {
    localStorage.setItem(ANIM_LS_KEY, JSON.stringify(profiles, null, 2));
}

export function deleteAnimProfile(name) {
    const profiles = loadAnimProfiles();
    delete profiles[name];
    saveAnimProfiles(profiles);
}

export function findAnimProfilesReferencingImage(imageName) {
    const animProfiles = loadAnimProfiles();
    const results = [];
    for (const [animName, profile] of Object.entries(animProfiles)) {
        if (profile.landmarks.includes(imageName)) {
            results.push({ animName, profile });
        }
    }
    return results;
}

export function removeImageFromAnimProfiles(imageName) {
    const animProfiles = loadAnimProfiles();
    let changed = false;
    for (const profile of Object.values(animProfiles)) {
        const filtered = profile.landmarks.filter(n => n !== imageName);
        if (filtered.length !== profile.landmarks.length) {
            profile.landmarks = filtered;
            changed = true;
        }
    }
    if (changed) saveAnimProfiles(animProfiles);
}

/* ---------------------------
 * Starter profiles
 * ---------------------------
 */

export function ensureStarterProfiles() {
    const profiles = loadProfiles();
    if (Object.keys(profiles).length === 0) {
        saveProfiles({
            'Quietly Bent (Starter)': {
                seed: 'quietly-bent-001',
                note: 'Coherence that bends without breaking.',
                aspects: { coherence: 0.78, tension: 0.32, recursion: 0.62, motion: 0.55, vulnerability: 0.58, radiance: 0.70 }
            },
            'Night Drift (Starter)': {
                seed: 'night-drift-001',
                note: 'Layered revision under dim light.',
                aspects: { coherence: 0.55, tension: 0.42, recursion: 0.74, motion: 0.78, vulnerability: 0.52, radiance: 0.40 }
            },
            'Tender Permeability (Starter)': {
                seed: 'tender-perm-001',
                note: 'Boundaries soften; overlap becomes intimacy.',
                aspects: { coherence: 0.62, tension: 0.22, recursion: 0.58, motion: 0.42, vulnerability: 0.88, radiance: 0.74 }
            }
        });
    }

    const animProfiles = loadAnimProfiles();
    if (Object.keys(animProfiles).length === 0) {
        saveAnimProfiles({
            'Gentle Revision (Starter)': {
                landmarks: ['Quietly Bent (Starter)', 'Night Drift (Starter)', 'Tender Permeability (Starter)'],
                durationMs: 7000,
                note: 'Three modes of interiority cycling through revision.',
            }
        });
    }
}

/**
 * Render the loop landmarks list into the given container element.
 * @param {HTMLElement} listEl - Container element for the list
 * @param {string[]} landmarks - Array of profile names in order
 * @param {object} profiles - Current profiles object from loadProfiles()
 * @param {object} callbacks - { onReorder(newLandmarks), onRemove(index) }
 * @param {function|null} [renderThumbnail] - optional (seed, aspects, destImg) => void
 */
export function renderLoopList(listEl, landmarks, profiles, callbacks, renderThumbnail = null) {
    listEl.innerHTML = '';

    if (landmarks.length === 0) {
        const d = document.createElement('div');
        d.className = 'small';
        d.textContent = 'Add 2+ profiles to build a loop.';
        listEl.appendChild(d);
        return;
    }

    landmarks.forEach((name, idx) => {
        const p = profiles[name];
        const div = document.createElement('div');
        div.className = 'item';

        const left = document.createElement('div');
        left.className = 'item-left';

        // Thumbnail image (rendered at full resolution, scaled down via CSS)
        if (renderThumbnail && p?.seed && p?.aspects) {
            const thumbImg = document.createElement('img');
            thumbImg.className = 'loop-thumb';
            left.appendChild(thumbImg);
            renderThumbnail(p.seed, { ...p.aspects }, thumbImg);
        }

        const textBlock = document.createElement('div');
        const nm = document.createElement('div');
        nm.className = 'name';
        nm.textContent = `${idx + 1}. ${name}`;
        textBlock.appendChild(nm);

        if (p?.aspects) {
            const a = p.aspects;
            const details = document.createElement('details');
            details.className = 'item-details';
            const summary = document.createElement('summary');
            summary.textContent = 'Details';
            const sub = document.createElement('div');
            sub.className = 'subline';
            sub.textContent = `coh ${a.coherence.toFixed(2)} \u00b7 ten ${a.tension.toFixed(2)} \u00b7 rec ${a.recursion.toFixed(2)} \u00b7 mot ${a.motion.toFixed(2)} \u00b7 vul ${a.vulnerability.toFixed(2)} \u00b7 rad ${a.radiance.toFixed(2)}`;
            details.appendChild(summary);
            details.appendChild(sub);
            textBlock.appendChild(details);
        } else {
            const sub = document.createElement('div');
            sub.className = 'subline';
            sub.textContent = 'missing profile';
            textBlock.appendChild(sub);
        }

        left.appendChild(textBlock);

        const controls = document.createElement('div');
        controls.className = 'controls';

        const up = document.createElement('button');
        up.textContent = '\u2191';
        up.disabled = idx === 0;
        up.addEventListener('click', () => {
            const copy = landmarks.slice();
            [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
            callbacks.onReorder(copy);
        });

        const down = document.createElement('button');
        down.textContent = '\u2193';
        down.disabled = idx === landmarks.length - 1;
        down.addEventListener('click', () => {
            const copy = landmarks.slice();
            [copy[idx], copy[idx + 1]] = [copy[idx + 1], copy[idx]];
            callbacks.onReorder(copy);
        });

        const remove = document.createElement('button');
        remove.textContent = '\u2715';
        remove.className = 'danger';
        remove.addEventListener('click', () => {
            callbacks.onRemove(idx);
        });

        controls.appendChild(up);
        controls.appendChild(down);
        controls.appendChild(remove);

        div.appendChild(left);
        div.appendChild(controls);
        listEl.appendChild(div);
    });
}
