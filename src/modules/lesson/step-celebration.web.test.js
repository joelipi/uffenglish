// step-celebration.web.test.js
// The runner: trigger dedupe (StrictMode), burst scheduling, custom-shape
// resolution with its fallback, and every failure path. The canvas-confetti
// loader is always injected — jsdom has no canvas, Path2D or DOMMatrix, so the
// real library must never be imported here.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStepCelebration, resetStepCelebrationState } from './step-celebration.web.js';
import { CELEBRATION_PATHS } from './step-celebration-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** A stand-in for the module's default export: callable, carrying the helpers. */
function makeConfetti() {
    const calls = [];
    const fire = (options) => { calls.push(options); };
    fire.shapeFromPath = vi.fn((definition) => ({ type: 'path', ...definition }));
    return { fire, calls };
}

function makeScheduler() {
    const tasks = [];
    const schedule = (fn, ms) => { tasks.push({ fn, ms }); };
    return { tasks, schedule, runAll: () => tasks.splice(0).forEach((task) => task.fn()) };
}

describe('runStepCelebration', () => {
    let warn;

    beforeEach(() => {
        resetStepCelebrationState();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        resetStepCelebrationState();
    });

    it('does nothing for a missing or unusable trigger', async () => {
        const loadConfetti = vi.fn();
        for (const trigger of [0, -1, undefined, null, Number.NaN, '3']) {
            expect(await runStepCelebration({ trigger, loadConfetti })).toBeNull();
        }
        expect(loadConfetti).not.toHaveBeenCalled();
    });

    it('schedules one burst per plan entry, in order, with the planned delay', async () => {
        const { fire, calls } = makeConfetti();
        const { tasks, schedule, runAll } = makeScheduler();

        const result = await runStepCelebration({
            trigger: 1,
            loadConfetti: async () => fire,
            schedule,
            random: () => 0.1,
        });

        expect(result.plan).toHaveLength(tasks.length);
        expect(tasks.map((task) => task.ms)).toEqual(result.plan.map((burst) => burst.delayMs));
        expect(calls).toHaveLength(0);

        runAll();
        expect(calls).toHaveLength(result.plan.length);
        calls.forEach((options, index) => {
            expect(options.disableForReducedMotion).toBe(true);
            expect(options.colors.length).toBeGreaterThan(0);
            expect(options.shapes.length).toBeGreaterThan(0);
        });
    });

    it('accepts a module namespace ({ default: fire }) as the loaded library', async () => {
        const { fire, calls } = makeConfetti();
        const { schedule, runAll } = makeScheduler();

        await runStepCelebration({
            trigger: 2,
            loadConfetti: async () => ({ default: fire }),
            schedule,
            random: () => 0.5,
        });
        runAll();

        expect(calls.length).toBeGreaterThan(0);
    });

    it('merges custom path shapes after the built-in ones', async () => {
        const { fire, calls } = makeConfetti();
        const { schedule, runAll } = makeScheduler();

        // Roll 0.1 with no previous variant picks index 0 (side cannons).
        await runStepCelebration({
            trigger: 3,
            loadConfetti: async () => fire,
            schedule,
            random: () => 0.1,
        });
        runAll();

        expect(fire.shapeFromPath).toHaveBeenCalledWith(CELEBRATION_PATHS.diamond);
        expect(calls[0].shapes.slice(0, 2)).toEqual(['square', 'circle']);
        expect(calls[0].shapes[2]).toMatchObject({ type: 'path', path: CELEBRATION_PATHS.diamond.path });
    });

    it('resolves each custom shape once for the life of the page', async () => {
        const { fire } = makeConfetti();
        const { schedule, runAll } = makeScheduler();
        const loadConfetti = async () => fire;

        const first = await runStepCelebration({ trigger: 1, loadConfetti, schedule, random: () => 0.1 });
        const second = await runStepCelebration({ trigger: 2, loadConfetti, schedule, random: () => 0.1 });
        // Same roll again from the second variant returns to the first one.
        const third = await runStepCelebration({ trigger: 3, loadConfetti, schedule, random: () => 0.9 });
        runAll();

        const distinctKeys = new Set(
            [...first.plan, ...second.plan, ...third.plan].flatMap((burst) => burst.customShapes)
        );
        expect(distinctKeys.size).toBeGreaterThan(1);
        expect(fire.shapeFromPath).toHaveBeenCalledTimes(distinctKeys.size);
    });

    it('falls back to the built-in shapes when shapeFromPath is unavailable', async () => {
        const { fire, calls } = makeConfetti();
        delete fire.shapeFromPath;
        const { schedule, runAll } = makeScheduler();

        const result = await runStepCelebration({
            trigger: 4,
            loadConfetti: async () => fire,
            schedule,
            random: () => 0.1,
        });
        runAll();

        expect(result).not.toBeNull();
        expect(calls[0].shapes).toEqual(['square', 'circle']);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/custom shapes unavailable/);
    });

    it('falls back when shapeFromPath throws, and keeps celebrating afterwards', async () => {
        const broken = makeConfetti();
        broken.fire.shapeFromPath = () => { throw new Error('nope'); };
        const { schedule, runAll } = makeScheduler();

        const failed = await runStepCelebration({
            trigger: 5,
            loadConfetti: async () => broken.fire,
            schedule,
            random: () => 0.1,
        });
        runAll();
        expect(failed).not.toBeNull();
        expect(broken.calls[0].shapes).toEqual(['square', 'circle']);
        expect(warn.mock.calls.filter((call) => /custom shapes unavailable/.test(call[0]))).toHaveLength(1);

        const healthy = makeConfetti();
        const next = await runStepCelebration({
            trigger: 6,
            loadConfetti: async () => healthy.fire,
            schedule,
            random: () => 0.1,
        });
        runAll();
        expect(next).not.toBeNull();
        expect(healthy.calls.length).toBeGreaterThan(0);
    });

    it('ignores the same trigger twice (StrictMode double effect)', async () => {
        const { fire, calls } = makeConfetti();
        const { tasks, schedule, runAll } = makeScheduler();

        await runStepCelebration({ trigger: 7, loadConfetti: async () => fire, schedule, random: () => 0.1 });
        const second = await runStepCelebration({ trigger: 7, loadConfetti: async () => fire, schedule, random: () => 0.1 });
        const scheduledPerBurst = tasks.length;
        runAll();

        expect(second).toBeNull();
        expect(calls).toHaveLength(scheduledPerBurst);
    });

    it('never repeats the previous variant across triggers', async () => {
        const { fire } = makeConfetti();
        const { schedule, runAll } = makeScheduler();
        const loadConfetti = async () => fire;

        const first = await runStepCelebration({ trigger: 8, loadConfetti, schedule, random: () => 0.1 });
        const second = await runStepCelebration({ trigger: 9, loadConfetti, schedule, random: () => 0.1 });
        runAll();

        expect(second.variantId).not.toBe(first.variantId);
    });

    it('propagates a loader failure and still celebrates a later trigger', async () => {
        const { fire, calls } = makeConfetti();
        const { schedule, runAll } = makeScheduler();

        await expect(runStepCelebration({
            trigger: 10,
            loadConfetti: async () => { throw new Error('chunk failed'); },
            schedule,
            random: () => 0.1,
        })).rejects.toThrow('chunk failed');

        await runStepCelebration({ trigger: 11, loadConfetti: async () => fire, schedule, random: () => 0.1 });
        runAll();
        expect(calls.length).toBeGreaterThan(0);
    });

    it('keeps firing the remaining bursts when one throws', async () => {
        const calls = [];
        const fire = (options) => {
            calls.push(options);
            if (calls.length === 1) throw new Error('boom');
        };
        fire.shapeFromPath = vi.fn((definition) => ({ type: 'path', ...definition }));
        const { schedule, runAll } = makeScheduler();

        // Variant 0 (side cannons) has two bursts, so the second must still run.
        const result = await runStepCelebration({
            trigger: 12,
            loadConfetti: async () => fire,
            schedule,
            random: () => 0.1,
        });
        runAll();

        expect(result.plan).toHaveLength(2);
        expect(calls).toHaveLength(2);
        expect(warn.mock.calls.filter((call) => /burst failed/.test(call[0]))).toHaveLength(1);
    });
});

describe('step-celebration.web.js source', () => {
    const source = readFileSync(path.join(__dirname, 'step-celebration.web.js'), 'utf8');

    it('imports canvas-confetti dynamically only', () => {
        expect(source).toContain("import('canvas-confetti')");
        expect(source).not.toMatch(/^import[^\n]*canvas-confetti/m);
    });

    it('reaches the shape helper through the default export, never by name', () => {
        expect(source).toContain('mod.default');
        expect(source).toMatch(/\.shapeFromPath\(/);
        expect(source).not.toMatch(/\{\s*shapeFromPath\s*\}/);
    });

    it('never resets the shared confetti canvas', () => {
        expect(source).not.toMatch(/\.reset\(/);
    });
});
