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
        `Title: ${title}`,
        ``,
        `Alt-text (interpretive):`,
        `A near-black luminous field carries ${recursionPhrase}, arranged with ${coherencePhrase}.`,
        `The forms overlap without fully merging—${boundaryPhrase}—while ${tensionPhrase} keeps the structure honest.`,
        `Across the surface, ${motionPhrase} like thought made visible: short paths that imply direction, then curve under revision.`,
        `${nodeCount} attractor nodes punctuate the composition, suggesting stable commitments that still radiate change.`,
        `Overall mood: ${tonePhrase}; coherence under revision; connection and separateness held in the same geometry.`
    ].join("\n");
}
