// modules/lesson/step-celebration-logic.js
// Pure rules for the end-of-step celebration on a friend closed-response step.
// No React, no DOM, no store, and no canvas-confetti call: the registry below is
// plain data (path strings + matrices) so this module stays importable under
// jsdom (which has neither Path2D nor DOMMatrix) and on React Native.
//
// Randomness is injected (defaulting to Math.random, evaluated per call) so every
// rule here is deterministic in tests.

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
 * Colour palettes. `classic` is canvas-confetti's own default list, so one fire
 * in four looks like the familiar confetti; the others are the app's palette.
 */
export const CELEBRATION_PALETTES = {
    ocean: ['#3a8fd5', '#00c0d8', '#8be8f5', '#ffffff'],
    sunset: ['#ff5e7e', '#ffa62d', '#fcff42', '#ffffff'],
    classic: ['#26ccff', '#a25afd', '#ff5e7e', '#88ff5a', '#fcff42', '#ffa62d', '#ff36ff'],
    mint: ['#88ff5a', '#26ccff', '#a25afd', '#ffffff'],
};

/** The shapes every canvas-confetti version has built in. */
export const BUILTIN_SHAPES = ['square', 'circle', 'star'];

/**
 * Seven visually distinct effects. A burst's `options.shapes` holds built-in
 * shape names and `customShapes` holds CELEBRATION_PATHS keys; the web runner
 * merges the two into the single `shapes` array the library reads.
 * Every burst here is short: a friend lesson has up to ~40 of these steps.
 */
export const CELEBRATION_VARIANTS = [
    {
        id: 'side-cannons',
        bursts: [
            {
                options: {
                    particleCount: 40, angle: 58, spread: 55, startVelocity: 52,
                    decay: 0.9, gravity: 1, ticks: 130, scalar: 0.9,
                    origin: { x: 0.06, y: 0.78 }, shapes: ['square', 'circle'],
                },
                customShapes: ['diamond'],
                delayMs: 0,
            },
            {
                options: {
                    particleCount: 40, angle: 122, spread: 55, startVelocity: 52,
                    decay: 0.9, gravity: 1, ticks: 130, scalar: 0.9,
                    origin: { x: 0.94, y: 0.78 }, shapes: ['square', 'circle'],
                },
                customShapes: ['diamond'],
                delayMs: 90,
            },
        ],
    },
    {
        id: 'star-shower',
        bursts: [
            {
                options: {
                    particleCount: 40, spread: 360, startVelocity: 26, decay: 0.91,
                    gravity: 0.9, ticks: 160, scalar: 1.15,
                    origin: { x: 0.5, y: 0.4 }, shapes: [],
                },
                customShapes: ['star'],
                delayMs: 0,
            },
        ],
    },
    {
        id: 'fountain',
        bursts: [
            {
                options: {
                    particleCount: 70, angle: 90, spread: 65, startVelocity: 55,
                    decay: 0.89, gravity: 1.2, ticks: 150, scalar: 1, flat: true,
                    origin: { x: 0.5, y: 0.97 }, shapes: ['circle', 'square'],
                },
                customShapes: [],
                delayMs: 0,
            },
        ],
    },
    {
        id: 'heart-drift',
        bursts: [
            {
                options: {
                    particleCount: 32, spread: 120, startVelocity: 24, decay: 0.93,
                    gravity: 0.6, drift: 0.55, ticks: 200, scalar: 1.1, flat: true,
                    origin: { x: 0.5, y: 0.85 }, shapes: [],
                },
                customShapes: ['heart'],
                delayMs: 0,
            },
        ],
    },
    {
        id: 'bolt-pops',
        bursts: [
            {
                options: {
                    particleCount: 30, spread: 360, startVelocity: 30, decay: 0.92,
                    gravity: 1, ticks: 120, scalar: 1,
                    origin: { x: 0.4, y: 0.45 }, shapes: [],
                },
                customShapes: ['bolt', 'sparkle'],
                delayMs: 0,
            },
            {
                options: {
                    particleCount: 30, spread: 360, startVelocity: 30, decay: 0.92,
                    gravity: 1, ticks: 120, scalar: 1,
                    origin: { x: 0.6, y: 0.55 }, shapes: [],
                },
                customShapes: ['bolt', 'sparkle'],
                delayMs: 110,
            },
        ],
    },
    {
        id: 'flat-burst',
        bursts: [
            {
                options: {
                    particleCount: 55, spread: 360, startVelocity: 34, decay: 0.91,
                    gravity: 1, ticks: 140, scalar: 1.2, flat: true,
                    origin: { x: 0.5, y: 0.5 }, shapes: ['square', 'circle'],
                },
                customShapes: [],
                delayMs: 0,
            },
        ],
    },
    {
        id: 'sparkle-drift',
        bursts: [
            {
                options: {
                    particleCount: 60, spread: 140, startVelocity: 22, decay: 0.9,
                    gravity: 0.55, drift: 0.5, ticks: 180, scalar: 0.8,
                    origin: { x: 0.5, y: 0.55 }, shapes: ['circle'],
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
 * Build the ready-to-fire plan for a variant: per-burst options with a random
 * palette and origin/spread/velocity jitter. Never mutates the exported
 * variants (each burst gets a fresh options/origin/shapes object).
 *
 * @param {number} variantIndex index into CELEBRATION_VARIANTS
 * @param {() => number} [random] injected RNG
 * @returns {Array<{ options: object, customShapes: string[], delayMs: number }>}
 */
export function buildCelebrationPlan(variantIndex, random = Math.random) {
    const variant = CELEBRATION_VARIANTS[variantIndex] || CELEBRATION_VARIANTS[0];
    const paletteKeys = Object.keys(CELEBRATION_PALETTES);
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
