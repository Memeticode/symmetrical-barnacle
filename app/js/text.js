/**
 * Title and alt-text generation from aspects.
 */

export function generateTitle(aspects, rng) {
    const coh = aspects.coherence, ten = aspects.tension, rec = aspects.recursion,
          mot = aspects.motion, vul = aspects.vulnerability, rad = aspects.radiance;

    const coherenceWord = coh > 0.82 ? "Axis of Certainty" : coh > 0.60 ? "Measured Reflection" : "Unstable Mirror";
    const tensionWord = ten > 0.70 ? "Fractured" : ten > 0.40 ? "Under Tension" : "Quietly Bent";
    const recursionWord = rec > 0.72 ? "Recursive Field" : rec > 0.42 ? "Layered Model" : "Sparse Geometry";
    const motionWord = mot > 0.70 ? "Predictive Drift" : mot > 0.40 ? "Directional Echo" : "Latent Motion";
    const boundaryWord = vul > 0.70 ? "Permeable" : vul > 0.40 ? "Soft-Boundary" : "Hard-Edged";
    const radianceWord = rad > 0.75 ? "Luminous" : rad > 0.50 ? "Soft Radiance" : "Dark Coherence";

    const templates = [
        `${tensionWord} ${recursionWord}`,
        `${radianceWord}: ${coherenceWord}`,
        `${motionWord} Across ${coherenceWord}`,
        `${boundaryWord} ${recursionWord}`,
        `${coherenceWord}, ${tensionWord}`,
        `${radianceWord} ${recursionWord}`,
        `${motionWord} in ${radianceWord}`,
        `${boundaryWord} ${tensionWord} ${recursionWord}`,
    ];

    return templates[Math.floor(rng() * templates.length)];
}

export function generateAltText(aspects, nodeCount, title) {
    const coherencePhrase = aspects.coherence > 0.82 ? "strong, almost ritual symmetry" : aspects.coherence > 0.62 ? "clear symmetry with deliberate slippage" : "loose symmetry, more suggestion than rule";
    const tensionPhrase = aspects.tension > 0.66 ? "visible fracture and purposeful misalignment" : aspects.tension > 0.34 ? "subtle tension at the edges of coherence" : "a mostly stable structure with faint stress lines";
    const recursionPhrase = aspects.recursion > 0.72 ? "densely layered, recursive geometry" : aspects.recursion > 0.46 ? "layered translucent polygons" : "a sparse set of geometric shards";
    const motionPhrase = aspects.motion > 0.70 ? "a prominent flow-field of vectors that bends and re-bends" : aspects.motion > 0.40 ? "a soft vector field suggesting prediction and revision" : "only a faint hint of directional flow";
    const boundaryPhrase = aspects.vulnerability > 0.70 ? "boundaries that bleed softly through each other" : aspects.vulnerability > 0.40 ? "semi-permeable edges where overlaps accumulate" : "edges that hold their separation";
    const tonePhrase = aspects.radiance > 0.75 ? "bright, glassy radiance" : aspects.radiance > 0.50 ? "soft, steady glow" : "low-light coherence";

    return [
        `A near-black luminous field carries ${recursionPhrase}, arranged with ${coherencePhrase}.`,
        `The forms overlap without fully merging—${boundaryPhrase}—while ${tensionPhrase} keeps the structure honest.`,
        `Across the surface, ${motionPhrase} like thought made visible: short paths that imply direction, then curve under revision.`,
        `${nodeCount} attractor nodes punctuate the composition, suggesting stable commitments that still radiate change.`,
        `Overall mood: ${tonePhrase}; coherence under revision; connection and separateness held in the same geometry.`
    ].join("\n");
}

/* ── Animation alt-text ── */

const ASPECT_KEYS = ['coherence', 'tension', 'recursion', 'motion', 'vulnerability', 'radiance'];

const DYNAMIC_PHRASES = {
    coherence:     'symmetry tightens and loosens, structure questioning its own axis',
    tension:       'fracture surfaces and heals, edges sharpening then softening',
    recursion:     'layers deepen and thin, the geometry rehearsing its own depth',
    motion:        'flow-fields strengthen and fade, prediction revising itself',
    vulnerability: 'boundaries open and close, separation negotiating intimacy',
    radiance:      'light swells and dims, warmth arriving and withdrawing',
};

const STABLE_PHRASES = {
    coherence:     'structural alignment holds steady',
    tension:       'tension holds at a consistent register',
    recursion:     'layer density remains constant',
    motion:        'the flow-field maintains its strength',
    vulnerability: 'boundary permeability stays fixed',
    radiance:      'luminosity persists unchanged',
};

const TRANSITION_VERBS = {
    coherence:     { rises: 'alignment gathering',    falls: 'symmetry loosening' },
    tension:       { rises: 'edges sharpening',       falls: 'tension releasing' },
    recursion:     { rises: 'layers accumulating',    falls: 'geometry simplifying' },
    motion:        { rises: 'drift accelerating',     falls: 'movement stilling' },
    vulnerability: { rises: 'boundaries softening',   falls: 'edges firming' },
    radiance:      { rises: 'light arriving',         falls: 'glow receding' },
};

/**
 * Generate alt-text for an animation loop that describes the journey.
 * @param {Array<{name: string, aspects: object}>} landmarks
 * @param {number} durationSecs
 * @param {Array<{name: string, title: string}>} keyframeTexts
 * @returns {string}
 */
export function generateAnimAltText(landmarks, durationSecs, keyframeTexts) {
    const n = landmarks.length;

    // Compute aspect ranges
    const ranges = {};
    for (const key of ASPECT_KEYS) {
        const values = landmarks.map(l => l.aspects[key]);
        const min = Math.min(...values);
        const max = Math.max(...values);
        ranges[key] = { min, max, spread: max - min };
    }

    // Classify dynamic vs stable
    const DYNAMIC_THRESHOLD = 0.15;
    const dynamicAspects = ASPECT_KEYS
        .filter(k => ranges[k].spread >= DYNAMIC_THRESHOLD)
        .sort((a, b) => ranges[b].spread - ranges[a].spread);
    const stableAspects = ASPECT_KEYS
        .filter(k => ranges[k].spread < DYNAMIC_THRESHOLD);

    const parts = [];

    // Opening
    parts.push(
        `A ${durationSecs}-second loop cycles through ${n} landmark${n !== 1 ? 's' : ''}, each a geometry of interiority under revision.`
    );

    // Dynamic aspects
    if (dynamicAspects.length > 0) {
        const phrases = dynamicAspects.map(k => DYNAMIC_PHRASES[k]);
        parts.push(`Across the cycle, ${phrases.join('; ')}.`);
    }

    // Stable aspects
    if (stableAspects.length > 0 && stableAspects.length < ASPECT_KEYS.length) {
        const phrases = stableAspects.map(k => STABLE_PHRASES[k]);
        parts.push(
            `Throughout, ${phrases.join('; ')}` +
            (stableAspects.length > 1 ? ' \u2014 the commitments this identity refuses to release.' : '.')
        );
    }

    // Per-transition descriptions
    if (n >= 2) {
        const transitions = [];
        for (let i = 0; i < n; i++) {
            const from = landmarks[i];
            const to = landmarks[(i + 1) % n];
            const fromTitle = keyframeTexts[i]?.title || from.name;
            const toTitle = keyframeTexts[(i + 1) % n]?.title || to.name;

            let maxDelta = 0, maxKey = ASPECT_KEYS[0];
            for (const key of ASPECT_KEYS) {
                const delta = Math.abs(to.aspects[key] - from.aspects[key]);
                if (delta > maxDelta) { maxDelta = delta; maxKey = key; }
            }

            const direction = to.aspects[maxKey] > from.aspects[maxKey] ? 'rises' : 'falls';
            const verb = TRANSITION_VERBS[maxKey]?.[direction] || 'the field shifting';
            transitions.push(`from \u201c${fromTitle}\u201d to \u201c${toTitle}\u201d: ${verb}`);
        }
        parts.push(`The journey moves ${transitions.join('; ')}.`);
    }

    // Closing
    parts.push(
        'Motion completes its cycle but never truly repeats. ' +
        'Forms overlap but do not collapse. ' +
        'The geometry returns to where it began, changed by having moved.'
    );

    return parts.join('\n');
}
