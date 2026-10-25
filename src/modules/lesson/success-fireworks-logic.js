// The final success fireworks (stories/095-celebration-app-palette).
//
// The success moment used to fire one `canvas-confetti` burst in the library's
// default rainbow. The owner's brief: same colours as the rest of the app, and
// "special" by being BIGGER and LONGER — three volleys at once from different
// points, then a wide closing volley.
//
// Pure data + a pure planner: the component only imports the plan and schedules
// it, so the sizes/lifetimes/palette can be asserted without a canvas.
//
// Sizing rule: every volley here is larger and lives longer than ANY step
// celebration burst (story 093's biggest is 90 pieces over 150 ticks). That is
// what makes the ending special — not a different colour set.

import { CELEBRATION_PALETTES } from './step-celebration-logic.js';

/**
 * The success palette: every colour the step celebrations use, in one set, with
 * the amber accent and the deep piece that keeps pieces visible over white cards.
 */
export const SUCCESS_FIREWORK_COLORS = [
    '#ffffff',
    '#eaf6ff',
    '#9fd8ff',
    '#3a8fd5',
    '#ffc24d',
    '#0b2036',
];

/** Volleys that start together (within this window) from different points. */
export const SUCCESS_FIREWORK_SIMULTANEOUS_MS = 150;

/**
 * Three simultaneous volleys (left, centre, right) plus one wide closing volley.
 * `ticks` is a lifetime in 60fps frames: 260-320 ≈ 4.3-5.3 s, longer than the
 * longest step celebration (190).
 */
export const SUCCESS_FIREWORK_VOLLEYS = [
    {
        delayMs: 0,
        options: {
            particleCount: 150, spread: 70, startVelocity: 58, decay: 0.92,
            gravity: 1, ticks: 260, scalar: 1.7, origin: { x: 0.2, y: 0.78 },
        },
    },
    {
        delayMs: 40,
        options: {
            particleCount: 210, spread: 120, startVelocity: 68, decay: 0.92,
            gravity: 1, ticks: 300, scalar: 1.9, origin: { x: 0.5, y: 0.62 },
        },
    },
    {
        delayMs: 80,
        options: {
            particleCount: 150, spread: 70, startVelocity: 58, decay: 0.92,
            gravity: 1, ticks: 260, scalar: 1.7, origin: { x: 0.8, y: 0.78 },
        },
    },
    {
        delayMs: 700,
        options: {
            particleCount: 240, spread: 140, startVelocity: 52, decay: 0.93,
            gravity: 0.9, ticks: 320, scalar: 2.1, origin: { x: 0.5, y: 0.7 },
        },
    },
];

/** Jitter limits, so two endings of the same lesson are not pixel-identical. */
export const SUCCESS_FIREWORK_JITTER = { origin: 0.03, spread: 6, startVelocity: 3 };

function rollFrom(random) {
    const value = Number(random());
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 0.999999;
    return value;
}

function jitter(random, max) {
    return (rollFrom(random) * 2 - 1) * max;
}

function clamp(value, [min, max]) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Build the burst options for the success moment.
 *
 * @param {{ random?: () => number, colors?: string[] }} [options]
 * @returns {Array<{ delayMs: number, options: object }>}
 */
export function buildSuccessFireworkPlan({ random = Math.random, colors = SUCCESS_FIREWORK_COLORS } = {}) {
    return SUCCESS_FIREWORK_VOLLEYS.map((volley) => ({
        delayMs: volley.delayMs,
        options: {
            ...volley.options,
            origin: {
                x: clamp(volley.options.origin.x + jitter(random, SUCCESS_FIREWORK_JITTER.origin), [0.05, 0.95]),
                y: clamp(volley.options.origin.y + jitter(random, SUCCESS_FIREWORK_JITTER.origin), [0.05, 0.95]),
            },
            spread: clamp(volley.options.spread + jitter(random, SUCCESS_FIREWORK_JITTER.spread), [20, 360]),
            startVelocity: clamp(volley.options.startVelocity + jitter(random, SUCCESS_FIREWORK_JITTER.startVelocity), [10, 90]),
            colors: [...colors],
            zIndex: 100,
            disableForReducedMotion: true,
        },
    }));
}

/**
 * The three volleys that read as "at once" (their delays stay inside the window).
 *
 * @param {Array<{ delayMs: number }>} plan
 * @returns {Array<{ delayMs: number }>}
 */
export function simultaneousVolleys(plan = buildSuccessFireworkPlan()) {
    return plan.filter((burst) => burst.delayMs <= SUCCESS_FIREWORK_SIMULTANEOUS_MS);
}

/**
 * The closing volley (or volleys) that extend the moment past the opening salvo.
 *
 * @param {Array<{ delayMs: number }>} plan
 * @returns {Array<{ delayMs: number }>}
 */
export function closingVolleys(plan = buildSuccessFireworkPlan()) {
    return plan.filter((burst) => burst.delayMs > SUCCESS_FIREWORK_SIMULTANEOUS_MS);
}

/**
 * The palette must include the amber accent and the deep navy piece, so the
 * fireworks read both on the blue gradient and over the white success card.
 *
 * @param {string[]} [colors]
 * @returns {boolean}
 */
export function hasAccentAndDepth(colors = SUCCESS_FIREWORK_COLORS) {
    const normalized = (Array.isArray(colors) ? colors : []).map((c) => String(c).toLowerCase());
    return normalized.includes('#ffc24d') && normalized.includes('#0b2036') && normalized.includes('#ffffff');
}

/** Re-exported so the success palette and the step palettes cannot drift apart. */
export const STEP_CELEBRATION_PALETTES = CELEBRATION_PALETTES;
