// step-celebration-logic.test.js
// The pure rules behind the end-of-step celebration: which variants exist, how
// one is picked without repeating, what a plan looks like, and which steps
// qualify. No canvas and no DOM — this suite runs under jsdom, which has no
// Path2D/DOMMatrix, proving the module never builds a shape itself.
import { describe, it, expect } from 'vitest';
import {
    CELEBRATION_PATHS,
    CELEBRATION_PALETTES,
    CELEBRATION_VARIANTS,
    CELEBRATION_JITTER,
    BUILTIN_SHAPES,
    buildCelebrationPlan,
    pickCelebrationVariant,
    shouldCelebrateStepEnd,
} from './step-celebration-logic.js';

const DESIGN_BOX_MATRIX = [1, 0, 0, 1, -5, -5];

describe('celebration shape registry', () => {
    it('defines the custom path shapes the variants reference', () => {
        const referenced = new Set(
            CELEBRATION_VARIANTS.flatMap((variant) => variant.bursts.flatMap((b) => b.customShapes))
        );
        expect(referenced.size).toBeGreaterThan(0);
        for (const key of referenced) {
            expect(Object.keys(CELEBRATION_PATHS), key).toContain(key);
        }
    });

    it('keeps every path a closed 10x10 SVG path with the design-box matrix', () => {
        for (const [key, shape] of Object.entries(CELEBRATION_PATHS)) {
            expect(shape.path, key).toMatch(/^M/);
            expect(shape.path, key).toMatch(/Z$/);
            expect(shape.matrix, key).toEqual(DESIGN_BOX_MATRIX);
        }
    });

    it('builds a plan with no Path2D/DOMMatrix in scope (jsdom has neither)', () => {
        expect(typeof globalThis.Path2D).toBe('undefined');
        expect(typeof globalThis.DOMMatrix).toBe('undefined');
        expect(() => buildCelebrationPlan(0, () => 0.5)).not.toThrow();
    });
});

describe('CELEBRATION_VARIANTS', () => {
    it('offers at least six visually distinct effects with unique ids', () => {
        expect(CELEBRATION_VARIANTS.length).toBeGreaterThanOrEqual(6);
        const ids = CELEBRATION_VARIANTS.map((variant) => variant.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('uses only built-in shape names in options.shapes', () => {
        for (const variant of CELEBRATION_VARIANTS) {
            for (const burst of variant.bursts) {
                for (const shape of burst.options.shapes || []) {
                    expect(BUILTIN_SHAPES, `${variant.id}`).toContain(shape);
                }
            }
        }
    });

    it('uses the custom-shape and flat capabilities of canvas-confetti >= 1.7', () => {
        const usesCustomShapes = CELEBRATION_VARIANTS.some((variant) =>
            variant.bursts.some((burst) => burst.customShapes.length > 0));
        const usesFlat = CELEBRATION_VARIANTS.some((variant) =>
            variant.bursts.some((burst) => burst.options.flat === true));
        expect(usesCustomShapes).toBe(true);
        expect(usesFlat).toBe(true);
    });
});

describe('pickCelebrationVariant', () => {
    it('picks uniformly when there is no previous variant', () => {
        expect(pickCelebrationVariant(-1, () => 0)).toEqual({
            index: 0,
            variant: CELEBRATION_VARIANTS[0],
        });
        expect(pickCelebrationVariant(-1, () => 0.999).index).toBe(CELEBRATION_VARIANTS.length - 1);
        expect(pickCelebrationVariant(undefined, () => 0.5).index).toBe(
            Math.floor(0.5 * CELEBRATION_VARIANTS.length)
        );
    });

    it('never repeats the previous variant', () => {
        for (let previous = 0; previous < CELEBRATION_VARIANTS.length; previous += 1) {
            for (const roll of [0, 0.5, 0.999]) {
                const { index } = pickCelebrationVariant(previous, () => roll);
                expect(index).not.toBe(previous);
                expect(index).toBeGreaterThanOrEqual(0);
                expect(index).toBeLessThan(CELEBRATION_VARIANTS.length);
            }
        }
    });

    it('falls back to a uniform pick for an invalid previous index', () => {
        for (const previous of [-2, 99, 1.5, null, Number.NaN, '3']) {
            const { index } = pickCelebrationVariant(previous, () => 0.999);
            expect(index).toBe(CELEBRATION_VARIANTS.length - 1);
        }
    });

    it('survives an out-of-range RNG value', () => {
        expect(pickCelebrationVariant(-1, () => 1).index).toBe(CELEBRATION_VARIANTS.length - 1);
        expect(pickCelebrationVariant(-1, () => -3).index).toBe(0);
        expect(pickCelebrationVariant(-1, () => Number.NaN).index).toBe(0);
    });
});

describe('buildCelebrationPlan', () => {
    it('adds no jitter at roll 0.5 and keeps the variant values', () => {
        const plan = buildCelebrationPlan(0, () => 0.5);
        const [first, second] = CELEBRATION_VARIANTS[0].bursts;
        expect(plan).toHaveLength(2);
        expect(plan[0].options.origin).toEqual(first.options.origin);
        expect(plan[0].options.spread).toBe(first.options.spread);
        expect(plan[0].options.startVelocity).toBe(first.options.startVelocity);
        expect(plan[1].options.origin).toEqual(second.options.origin);
        expect(plan[0].delayMs).toBe(first.delayMs);
        expect(plan[1].delayMs).toBe(second.delayMs);
    });

    it('clamps every jittered value inside its bounds', () => {
        const lowPlan = buildCelebrationPlan(2, () => 0);
        const highPlan = buildCelebrationPlan(2, () => 0.999);
        for (const plan of [lowPlan, highPlan]) {
            for (const burst of plan) {
                expect(burst.options.origin.x).toBeGreaterThanOrEqual(0.03);
                expect(burst.options.origin.x).toBeLessThanOrEqual(0.97);
                expect(burst.options.origin.y).toBeGreaterThanOrEqual(0.03);
                expect(burst.options.origin.y).toBeLessThanOrEqual(0.97);
                expect(burst.options.spread).toBeGreaterThanOrEqual(10);
                expect(burst.options.spread).toBeLessThanOrEqual(360);
                expect(burst.options.startVelocity).toBeGreaterThanOrEqual(10);
                expect(burst.options.startVelocity).toBeLessThanOrEqual(80);
            }
        }
        // A bottom-anchored origin cannot be pushed outside the viewport.
        expect(highPlan[0].options.origin.y).toBe(0.97);
    });

    it('applies the jitter limits in both directions', () => {
        const low = buildCelebrationPlan(1, () => 0)[0].options;
        const high = buildCelebrationPlan(1, () => 0.999)[0].options;
        expect(high.origin.x - low.origin.x).toBeCloseTo(CELEBRATION_JITTER.origin * 2, 2);
        expect(high.origin.y - low.origin.y).toBeCloseTo(CELEBRATION_JITTER.origin * 2, 2);
        expect(high.startVelocity - low.startVelocity).toBeCloseTo(CELEBRATION_JITTER.startVelocity * 2, 1);
        // The star shower is a 360 spread: the upward jitter is clamped to 360,
        // the downward one is a real 354.
        expect(high.spread).toBe(360);
        expect(low.spread).toBe(354);
    });

    it('gives every burst a palette, the shared z-index and reduced-motion opt-in', () => {
        const palettes = Object.values(CELEBRATION_PALETTES);
        for (let index = 0; index < CELEBRATION_VARIANTS.length; index += 1) {
            const plan = buildCelebrationPlan(index, () => 0.25);
            CELEBRATION_VARIANTS[index].bursts.forEach((variantBurst, burstIndex) => {
                const burst = plan[burstIndex];
                expect(palettes).toContainEqual(burst.options.colors);
                expect(burst.options.zIndex).toBe(100);
                expect(burst.options.disableForReducedMotion).toBe(true);
                expect(burst.delayMs).toBeGreaterThanOrEqual(0);
                expect(burst.customShapes).toEqual(variantBurst.customShapes);
            });
        }
    });

    it('never mutates the exported variants', () => {
        const before = JSON.stringify(CELEBRATION_VARIANTS);
        const first = buildCelebrationPlan(0, () => 0);
        const second = buildCelebrationPlan(0, () => 0.999);
        expect(first[0].options.origin).not.toEqual(second[0].options.origin);
        expect(JSON.stringify(CELEBRATION_VARIANTS)).toBe(before);
        // The plan owns its arrays, so writing to one cannot leak into the next.
        first[0].options.shapes.push('star');
        expect(buildCelebrationPlan(0, () => 0.5)[0].options.shapes).not.toContain('star');
    });

    it('falls back to the first variant for an unknown index', () => {
        expect(buildCelebrationPlan(999, () => 0.5)).toEqual(buildCelebrationPlan(0, () => 0.5));
        expect(buildCelebrationPlan(undefined, () => 0.5)).toEqual(buildCelebrationPlan(0, () => 0.5));
    });
});

describe('shouldCelebrateStepEnd', () => {
    it('celebrates a friend closed-response step, with or without a clip', () => {
        expect(shouldCelebrateStepEnd({ responseType: 'friendClosedResponse' })).toBe(true);
        expect(shouldCelebrateStepEnd({ responseType: 'friendClosedResponse', simpleVideoUrl: 'x' })).toBe(true);
    });

    it('leaves every other step type alone', () => {
        for (const responseType of [
            'closedResponse', 'openResponse', 'branching', 'viewAndContinue',
            'lessonIntro', 'success',
        ]) {
            expect(shouldCelebrateStepEnd({ responseType }), responseType).toBe(false);
        }
        expect(shouldCelebrateStepEnd(null)).toBe(false);
        expect(shouldCelebrateStepEnd(undefined)).toBe(false);
        expect(shouldCelebrateStepEnd({})).toBe(false);
    });
});
