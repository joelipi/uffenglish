// The final success fireworks (stories/095-celebration-app-palette).
//
// The ending is meant to be the special one by SCALE and DURATION — three volleys
// at once from different points plus a wide closing volley — in the same app
// palette as the step celebrations.

import { describe, it, expect } from 'vitest';
import {
    SUCCESS_FIREWORK_COLORS,
    SUCCESS_FIREWORK_SIMULTANEOUS_MS,
    SUCCESS_FIREWORK_VOLLEYS,
    buildSuccessFireworkPlan,
    closingVolleys,
    hasAccentAndDepth,
    simultaneousVolleys,
} from './success-fireworks-logic.js';
import { CELEBRATION_VARIANTS } from './step-celebration-logic.js';

const MAX_STEP_PARTICLES = Math.max(...CELEBRATION_VARIANTS.flatMap((v) => v.bursts.map((b) => b.options.particleCount)));
const MAX_STEP_TICKS = Math.max(...CELEBRATION_VARIANTS.flatMap((v) => v.bursts.map((b) => b.options.ticks)));

describe('the success moment is three volleys at once plus a closing one', () => {
    it('starts three volleys inside the simultaneous window from different points', () => {
        const opening = simultaneousVolleys();
        expect(opening).toHaveLength(3);
        opening.forEach((burst) => {
            expect(burst.delayMs).toBeLessThanOrEqual(SUCCESS_FIREWORK_SIMULTANEOUS_MS);
        });
        const xs = new Set(opening.map((burst) => burst.options.origin.x.toFixed(2)));
        expect(xs.size).toBe(3);
    });

    it('adds a closing volley well after the opening salvo', () => {
        const closing = closingVolleys();
        expect(closing.length).toBeGreaterThanOrEqual(1);
        closing.forEach((burst) => {
            expect(burst.delayMs).toBeGreaterThan(SUCCESS_FIREWORK_SIMULTANEOUS_MS * 2);
        });
    });
});

describe('the success fireworks are bigger and longer than a step celebration', () => {
    it('every volley has more pieces than the biggest step burst', () => {
        buildSuccessFireworkPlan({ random: () => 0.5 }).forEach((burst) => {
            expect(burst.options.particleCount).toBeGreaterThan(MAX_STEP_PARTICLES);
        });
    });

    it('every volley lives longer than the longest step burst', () => {
        buildSuccessFireworkPlan({ random: () => 0.5 }).forEach((burst) => {
            expect(burst.options.ticks).toBeGreaterThan(MAX_STEP_TICKS);
        });
    });

    it('keeps its pieces generous rather than tiny', () => {
        // The step celebrations need scalar >= 2 for their custom PATH shapes to
        // read (story 093); the success volleys use the built-in shapes, so the
        // "bigger" claim is count and lifetime — but the pieces still have to be
        // visibly substantial.
        buildSuccessFireworkPlan({ random: () => 0.5 }).forEach((burst) => {
            expect(burst.options.scalar).toBeGreaterThanOrEqual(1.7);
        });
    });
});

describe('the success fireworks wear the app palette', () => {
    it('every volley uses the full palette, accent included', () => {
        buildSuccessFireworkPlan({ random: () => 0.5 }).forEach((burst) => {
            expect(burst.options.colors).toEqual(SUCCESS_FIREWORK_COLORS);
        });
    });

    it('the palette carries white, the deep navy and the amber accent', () => {
        expect(hasAccentAndDepth()).toBe(true);
        expect(hasAccentAndDepth(['#ffffff', '#0b2036'])).toBe(false);
        expect(hasAccentAndDepth(['#ffffff', '#ffc24d'])).toBe(false);
        expect(hasAccentAndDepth([])).toBe(false);
    });

    it('keeps the shared canvas contract (z-index, reduced motion)', () => {
        buildSuccessFireworkPlan({ random: () => 0.5 }).forEach((burst) => {
            expect(burst.options.zIndex).toBe(100);
            expect(burst.options.disableForReducedMotion).toBe(true);
        });
    });
});

describe('the planner is deterministic under an injected RNG', () => {
    it('produces the same plan twice for the same roll', () => {
        expect(buildSuccessFireworkPlan({ random: () => 0.5 }))
            .toEqual(buildSuccessFireworkPlan({ random: () => 0.5 }));
    });

    it('jitters the origins between firings', () => {
        const low = buildSuccessFireworkPlan({ random: () => 0 });
        const high = buildSuccessFireworkPlan({ random: () => 0.999 });
        expect(low[0].options.origin.x).not.toBeCloseTo(high[0].options.origin.x, 3);
        // ...but never off the frame.
        low.concat(high).forEach((burst) => {
            expect(burst.options.origin.x).toBeGreaterThanOrEqual(0.05);
            expect(burst.options.origin.x).toBeLessThanOrEqual(0.95);
        });
    });

    it('keeps the configured volley count and delays', () => {
        const plan = buildSuccessFireworkPlan({ random: () => 0.5 });
        expect(plan.map((b) => b.delayMs)).toEqual(SUCCESS_FIREWORK_VOLLEYS.map((b) => b.delayMs));
    });
});
