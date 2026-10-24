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

describe('custom shapes stay readable (canvas-confetti draw maths)', () => {
    // A path shape draws at `pathScale * (|x2 - x1| * 0.1)`, and |x2 - x1| is
    // 10 * scalar * |cos(wobble)| unless the particle is flat. A non-flat path
    // therefore collapses to a zero-width sliver twice per spin and a 10-unit
    // path at scalar 1 is only 10px wide (the built-in star is 16 * scalar).
    // Both mistakes make "the stars" indistinguishable — regressions seen in
    // review of the first implementation.
    it('marks every custom-path burst flat and at least 2x scale', () => {
        for (const variant of CELEBRATION_VARIANTS) {
            for (const burst of variant.bursts) {
                if (burst.customShapes.length === 0) continue;
                expect(burst.options.flat, `${variant.id} must be flat`).toBe(true);
                expect(burst.options.scalar, `${variant.id} scalar`).toBeGreaterThanOrEqual(2);
            }
        }
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

    it('gives every variant its own palette list drawn from the registry', () => {
        for (const variant of CELEBRATION_VARIANTS) {
            expect(Array.isArray(variant.palettes), variant.id).toBe(true);
            expect(variant.palettes.length).toBeGreaterThan(0);
            for (const key of variant.palettes) {
                expect(Object.keys(CELEBRATION_PALETTES), variant.id).toContain(key);
            }
        }
        // The hue is part of a variant's identity, so they cannot all share one.
        const paletteUse = new Set(CELEBRATION_VARIANTS.flatMap((variant) => variant.palettes));
        expect(paletteUse.size).toBeGreaterThanOrEqual(5);
    });

    it('differs physically between variants, not just in option values', () => {
        // Where it starts, which way it goes, how big and how long it lives.
        const signature = (variant) => variant.bursts
            .map((burst) => [
                burst.options.origin.y < 0.2 ? 'top' : burst.options.origin.y > 0.8 ? 'bottom' : 'mid',
                burst.options.origin.x < 0.25 ? 'left' : burst.options.origin.x > 0.75 ? 'right' : 'centre',
                burst.options.angle === 90 ? 'up' : burst.options.angle === 270 ? 'down' : 'sided',
                burst.options.gravity < 0 ? 'rising' : 'falling',
                burst.options.scalar >= 2.5 ? 'large' : burst.options.scalar >= 1.6 ? 'medium' : 'small',
                burst.options.ticks <= 110 ? 'short' : burst.options.ticks >= 180 ? 'long' : 'medium-life',
            ].join('/'))
            .join('|');
        const signatures = CELEBRATION_VARIANTS.map(signature);
        expect(new Set(signatures).size).toBe(signatures.length);

        // The signatures are real claims, not labels: assert the edges exist.
        const allBursts = CELEBRATION_VARIANTS.flatMap((variant) => variant.bursts);
        expect(allBursts.some((burst) => burst.options.angle === 270)).toBe(true); // falling rain
        expect(allBursts.some((burst) => burst.options.gravity < 0)).toBe(true); // rising hearts
        expect(allBursts.some((burst) => burst.options.origin.y > 0.95)).toBe(true); // bottom plume
        expect(allBursts.some((burst) => burst.options.origin.x < 0.05)).toBe(true); // side cannons
        expect(allBursts.some((burst) => burst.options.ticks <= 110)).toBe(true); // snappy pops
        expect(allBursts.some((burst) => burst.options.ticks >= 180)).toBe(true); // lingering drift
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
        // star-shower (index 1) sits on the top edge; bolt-pops (4) spreads 360;
        // sparkle-drift (6) starts at the 10 px/tick velocity floor.
        for (const index of [1, 4, 6]) {
            for (const roll of [0, 0.999]) {
                for (const burst of buildCelebrationPlan(index, () => roll)) {
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
        }
        // A top-edge origin cannot be pushed above the viewport...
        expect(buildCelebrationPlan(1, () => 0)[0].options.origin.y).toBe(0.03);
        // ...a full 360 spread cannot exceed 360...
        expect(buildCelebrationPlan(4, () => 0.999)[0].options.spread).toBe(360);
        // ...and the slow drift cannot be pushed under the velocity floor.
        expect(buildCelebrationPlan(6, () => 0)[0].options.startVelocity).toBe(10);
    });

    it('applies the jitter limits in both directions', () => {
        // bolt-pops (4) sits mid-air, so its origin jitter is never clamped.
        const lowMid = buildCelebrationPlan(4, () => 0)[0].options;
        const highMid = buildCelebrationPlan(4, () => 0.999)[0].options;
        expect(highMid.origin.x - lowMid.origin.x).toBeCloseTo(CELEBRATION_JITTER.origin * 2, 3);
        expect(highMid.origin.y - lowMid.origin.y).toBeCloseTo(CELEBRATION_JITTER.origin * 2, 3);

        // star-shower (1) has a 40 spread and 14 velocity, both unclamped.
        const lowRain = buildCelebrationPlan(1, () => 0)[0].options;
        const highRain = buildCelebrationPlan(1, () => 0.999)[0].options;
        expect(highRain.spread - lowRain.spread).toBeCloseTo(CELEBRATION_JITTER.spread * 2, 1);
        expect(highRain.startVelocity - lowRain.startVelocity)
            .toBeCloseTo(CELEBRATION_JITTER.startVelocity * 2, 1);
    });

    it('picks the palette from the variant own list', () => {
        for (let index = 0; index < CELEBRATION_VARIANTS.length; index += 1) {
            const allowed = CELEBRATION_VARIANTS[index].palettes.map((key) => CELEBRATION_PALETTES[key]);
            for (const roll of [0, 0.5, 0.999]) {
                for (const burst of buildCelebrationPlan(index, () => roll)) {
                    expect(allowed, CELEBRATION_VARIANTS[index].id).toContainEqual(burst.options.colors);
                }
            }
        }
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
