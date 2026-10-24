// modules/lesson/step-celebration-logic.js
// Pure rules for the end-of-step celebration on a friend closed-response step.
// No React, no DOM, no store, and no canvas-confetti call: the registry below is
// plain data (path strings + matrices) so this module stays importable under
// jsdom (which has neither Path2D nor DOMMatrix) and on React Native.
//
// Randomness is injected (defaulting to Math.random, evaluated per call) so every
// rule here is deterministic in tests.
//
// Two canvas-confetti facts drive the numbers in this file (read from
// node_modules/canvas-confetti/src/confetti.js `updateFetti`):
//
//   1. A path shape is drawn at `pathScale * (|x2 - x1| * 0.1)`. For a flat
//      particle |x2 - x1| === 10 * scalar, so the draw scale is exactly
//      `scalar`: our 10-unit paths render 10 * scalar px. The built-in star is
//      16 * scalar px wide, so a custom shape needs `scalar >= 2` to read.
//   2. For a NON-flat particle |x2 - x1| === 10 * scalar * |cos(wobble)|, so the
//      path collapses to a zero-width sliver twice per spin. Every burst that
//      carries a path shape therefore sets `flat: true`; otherwise the star is
//      unreadable most of its life.

/**
 * The design box every custom path is authored in: a 10x10 square. The matrix is
 * what canvas-confetti's `shapeFromPath` would derive for such a path (scale 1,
 * translate -width/2, -height/2), hard-coded because the README recommends
 * computing it once and the helper otherwise samples ~250k `isPointInPath` hits.
 */
const DESIGN_BOX_MATRIX = [1, 0, 0, 1, -5, -5];

/**
 * Custom confetti shapes (canvas-confetti >= 1.7 `shapeFromPath`). Path strings
 * survive the library's default worker postMessage (the worker re-creates the
 * Path2D when drawing), so these are safe with `useWorker: true`.
 * Keys are referenced by a variant's `customShapes`.
 *
 * Each path fills the 10x10 box and is a silhouette (no holes/marks) so it stays
 * recognisable at 20-30px.
 */
export const CELEBRATION_PATHS = {
    star: {
        path: 'M5 0 L6.18 3.55 L10 3.55 L6.9 5.9 L8.09 9.51 L5 7.2 L1.91 9.51 L3.1 5.9 L0 3.55 L3.82 3.55 Z',
        matrix: [...DESIGN_BOX_MATRIX],
    },
    diamond: {
        path: 'M5 0 L10 5 L5 10 L0 5 Z',
        matrix: [...DESIGN_BOX_MATRIX],
    },
    heart: {
        path: 'M5 10 L0.9 5.6 C-0.6 3.7 0.6 0.6 3 0.6 C4.1 0.6 4.8 1.3 5 1.9 C5.2 1.3 5.9 0.6 7 0.6 C9.4 0.6 10.6 3.7 9.1 5.6 Z',
        matrix: [...DESIGN_BOX_MATRIX],
    },
    sparkle: {
        path: 'M5 0 L6 4 L10 5 L6 6 L5 10 L4 6 L0 5 L4 4 Z',
        matrix: [...DESIGN_BOX_MATRIX],
    },
    bolt: {
        path: 'M6 0 L1 6 L4.5 6 L3 10 L9 3.5 L5.5 3.5 Z',
        matrix: [...DESIGN_BOX_MATRIX],
    },
};

/**
 * Colour palettes. Each variant allows one or two of them (see `palettes`), so a
 * variant keeps its own identity — "the red one", "the gold one" — while still
 * varying between two firings. `classic` is canvas-confetti's own default list.
 */
export const CELEBRATION_PALETTES = {
    sunset: ['#ff5e7e', '#ffa62d', '#fcff42', '#ffffff'],
    gold: ['#ffd166', '#ffb703', '#fff3b0', '#ffffff'],
    candy: ['#ff7ab6', '#ff3d7f', '#b388ff', '#ffffff'],
    electric: ['#7c4dff', '#ffea00', '#ffffff', '#ff3d7f'],
    ice: ['#ffffff', '#d7f9ff', '#a7c7ff'],
    classic: ['#26ccff', '#a25afd', '#ff5e7e', '#88ff5a', '#fcff42', '#ffa62d', '#ff36ff'],
};

/** The shapes every canvas-confetti version has built in. */
export const BUILTIN_SHAPES = ['square', 'circle', 'star'];

/**
 * Seven effects with different PHYSICAL SIGNATURES, not just different options:
 * where they start (bottom corners / top edge / bottom centre / mid-air /
 * centre), which way they move (rising, falling, spraying), how long they live
 * (95-190 ticks) and how big the pieces are (scalar 1.2-2.8). A learner should
 * be able to name the effect from a single frame.
 *
 * A burst's `options.shapes` holds built-in shape names and `customShapes` holds
 * CELEBRATION_PATHS keys; the web runner merges the two into the single `shapes`
 * array the library reads. Every burst here is short: a friend lesson has up to
 * ~40 of these steps, so the app is mid-next-step while it plays.
 */
export const CELEBRATION_VARIANTS = [
    {
        // Two narrow, fast diagonal streams out of the bottom corners.
        id: 'side-cannons',
        palettes: ['sunset', 'candy'],
        bursts: [
            {
                options: {
                    particleCount: 38, angle: 55, spread: 34, startVelocity: 62,
                    decay: 0.9, gravity: 0.95, ticks: 170, scalar: 2, flat: true,
                    origin: { x: 0.03, y: 0.86 }, shapes: ['square', 'circle'],
                },
                customShapes: ['diamond'],
                delayMs: 0,
            },
            {
                options: {
                    particleCount: 38, angle: 125, spread: 34, startVelocity: 62,
                    decay: 0.9, gravity: 0.95, ticks: 170, scalar: 2, flat: true,
                    origin: { x: 0.97, y: 0.86 }, shapes: ['square', 'circle'],
                },
                customShapes: ['diamond'],
                delayMs: 60,
            },
        ],
    },
    {
        // Big slow stars RAINING FROM THE TOP EDGE (angle 270 fires downward).
        id: 'star-shower',
        palettes: ['gold', 'ice'],
        bursts: [
            {
                options: {
                    particleCount: 24, angle: 270, spread: 40, startVelocity: 14,
                    decay: 0.97, gravity: 0.85, ticks: 175, scalar: 2.8, flat: true,
                    origin: { x: 0.3, y: 0.03 }, shapes: [],
                },
                customShapes: ['star'],
                delayMs: 0,
            },
            {
                options: {
                    particleCount: 24, angle: 270, spread: 40, startVelocity: 14,
                    decay: 0.97, gravity: 0.85, ticks: 175, scalar: 2.8, flat: true,
                    origin: { x: 0.7, y: 0.03 }, shapes: [],
                },
                customShapes: ['star'],
                delayMs: 140,
            },
        ],
    },
    {
        // One tall narrow plume from the bottom centre that falls back down.
        id: 'fountain',
        palettes: ['gold', 'sunset'],
        bursts: [
            {
                options: {
                    particleCount: 80, angle: 90, spread: 30, startVelocity: 46,
                    decay: 0.9, gravity: 2, ticks: 165, scalar: 1.6, flat: true,
                    origin: { x: 0.5, y: 0.97 }, shapes: ['circle', 'square'],
                },
                // A fine spray: the pellets are deliberately small (scalar 1.2),
                // which is under the >= 2 rule for a readable path shape.
                customShapes: [],
                delayMs: 0,
            },
        ],
    },
    {
        // Hearts RISING from the bottom: angle 90 is up, and negative gravity
        // keeps accelerating them up instead of pulling them back.
        id: 'heart-drift',
        palettes: ['candy', 'sunset'],
        bursts: [
            {
                options: {
                    particleCount: 30, angle: 90, spread: 26, startVelocity: 12,
                    decay: 0.96, gravity: -0.1, drift: 0, ticks: 185, scalar: 2.6, flat: true,
                    origin: { x: 0.5, y: 0.9 }, shapes: [],
                },
                customShapes: ['heart'],
                delayMs: 0,
            },
        ],
    },
    {
        // Two short, hard pops in mid-air: highest speed, shortest life.
        id: 'bolt-pops',
        palettes: ['electric'],
        bursts: [
            {
                options: {
                    particleCount: 44, spread: 360, startVelocity: 22,
                    decay: 0.93, gravity: 0.7, ticks: 105, scalar: 2.2, flat: true,
                    origin: { x: 0.32, y: 0.45 }, shapes: [],
                },
                customShapes: ['bolt', 'sparkle'],
                delayMs: 0,
            },
            {
                options: {
                    particleCount: 44, spread: 360, startVelocity: 22,
                    decay: 0.93, gravity: 0.7, ticks: 105, scalar: 2.2, flat: true,
                    origin: { x: 0.68, y: 0.55 }, shapes: [],
                },
                customShapes: ['bolt', 'sparkle'],
                delayMs: 70,
            },
        ],
    },
    {
        // The biggest single blast: 90 big flat ribbons from dead centre.
        id: 'flat-burst',
        palettes: ['classic'],
        bursts: [
            {
                options: {
                    particleCount: 90, spread: 360, startVelocity: 40,
                    decay: 0.91, gravity: 1, ticks: 150, scalar: 1.8, flat: true,
                    origin: { x: 0.5, y: 0.5 }, shapes: ['square', 'circle'],
                },
                customShapes: [],
                delayMs: 0,
            },
        ],
    },
    {
        // A slow, sparkly cloud that sinks and drifts sideways.
        id: 'sparkle-drift',
        palettes: ['ice', 'gold'],
        bursts: [
            {
                options: {
                    particleCount: 44, spread: 180, startVelocity: 10,
                    decay: 0.95, gravity: 0.35, drift: 0.4, ticks: 190, scalar: 2, flat: true,
                    origin: { x: 0.5, y: 0.45 }, shapes: ['circle'],
                },
                customShapes: ['sparkle'],
                delayMs: 0,
            },
        ],
    },
];

/** Jitter limits applied per burst (max +/- value). */
export const CELEBRATION_JITTER = {
    origin: 0.04,
    spread: 6,
    startVelocity: 4,
};

/** Clamp bounds for the jittered values. */
const BOUNDS = {
    origin: [0.03, 0.97],
    spread: [10, 360],
    startVelocity: [10, 80],
};

/** A deterministic draw in [0, 1) even if the injected random misbehaves. */
function rollFrom(random) {
    const value = Number(random());
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 0.999999;
    return value;
}

function clamp(value, [min, max]) {
    return Math.min(Math.max(value, min), max);
}

function jitter(random, max) {
    return (rollFrom(random) * 2 - 1) * max;
}

/**
 * Pick a variant at random, never repeating the previous one (while there is
 * more than one) so consecutive steps look different.
 *
 * @param {number} previousIndex index used last time, -1/undefined when none
 * @param {() => number} [random] injected RNG
 * @returns {{ index: number, variant: object }}
 */
export function pickCelebrationVariant(previousIndex = -1, random = Math.random) {
    const count = CELEBRATION_VARIANTS.length;
    const roll = rollFrom(random);
    const previousIsValid = Number.isInteger(previousIndex)
        && previousIndex >= 0
        && previousIndex < count;
    const index = previousIsValid
        ? (previousIndex + 1 + Math.floor(roll * (count - 1))) % count
        : Math.floor(roll * count);
    return { index, variant: CELEBRATION_VARIANTS[index] };
}

/**
 * Build the ready-to-fire plan for a variant: per-burst options with one of the
 * variant's palettes and origin/spread/velocity jitter. Never mutates the
 * exported variants (each burst gets a fresh options/origin/shapes object).
 *
 * @param {number} variantIndex index into CELEBRATION_VARIANTS
 * @param {() => number} [random] injected RNG
 * @returns {Array<{ options: object, customShapes: string[], delayMs: number }>}
 */
export function buildCelebrationPlan(variantIndex, random = Math.random) {
    const variant = CELEBRATION_VARIANTS[variantIndex] || CELEBRATION_VARIANTS[0];
    const paletteKeys = variant.palettes && variant.palettes.length
        ? variant.palettes
        : Object.keys(CELEBRATION_PALETTES);
    const palette = CELEBRATION_PALETTES[paletteKeys[Math.floor(rollFrom(random) * paletteKeys.length)]];

    return variant.bursts.map((burst) => {
        const origin = burst.options.origin || { x: 0.5, y: 0.5 };
        return {
            options: {
                ...burst.options,
                origin: {
                    x: clamp(origin.x + jitter(random, CELEBRATION_JITTER.origin), BOUNDS.origin),
                    y: clamp(origin.y + jitter(random, CELEBRATION_JITTER.origin), BOUNDS.origin),
                },
                spread: clamp(
                    (burst.options.spread ?? 45) + jitter(random, CELEBRATION_JITTER.spread),
                    BOUNDS.spread
                ),
                startVelocity: clamp(
                    (burst.options.startVelocity ?? 45) + jitter(random, CELEBRATION_JITTER.startVelocity),
                    BOUNDS.startVelocity
                ),
                shapes: [...(burst.options.shapes || [])],
                colors: [...palette],
                // The same body-level canvas (and z-index) the success effect uses.
                zIndex: 100,
                disableForReducedMotion: true,
            },
            customShapes: [...(burst.customShapes || [])],
            delayMs: burst.delayMs,
        };
    });
}

/**
 * Whether finishing this step is a celebration moment. Only a friend
 * closed-response step qualifies — every other step type keeps its own flow.
 *
 * @param {{ responseType?: string }|null|undefined} step
 * @returns {boolean}
 */
export function shouldCelebrateStepEnd(step) {
    return step?.responseType === 'friendClosedResponse';
}
