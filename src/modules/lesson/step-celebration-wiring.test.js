// step-celebration-wiring.test.js
// Static guards for the end-of-step celebration wiring: the trigger dispatch
// lives inside the advance path (after the per-step reset), the effect component
// is mounted exactly once and holds no logic, and the success screen keeps its
// own, untouched effect. Asserted on raw source, never comment-stripped.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const progression = readFileSync(path.join(__dirname, 'lesson-progression.js'), 'utf8');
const container = readFileSync(path.join(REPO_ROOT, 'src/components/LessonContainer.jsx'), 'utf8');
const component = readFileSync(path.join(REPO_ROOT, 'src/components/widgets/StepCelebration.jsx'), 'utf8');
const successEffects = readFileSync(path.join(REPO_ROOT, 'src/components/widgets/SuccessEffects.jsx'), 'utf8');

/** The loadNextStep body only: bounded at the next top-level function. */
function loadNextStepRegion() {
    const start = progression.indexOf('function loadNextStep');
    const end = progression.indexOf('// Branching navigation');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return progression.slice(start, end);
}

describe('celebration trigger in loadNextStep', () => {
    it('imports the pure rule from the celebration logic module', () => {
        expect(progression).toContain("from './step-celebration-logic.js'");
        expect(progression).toContain('shouldCelebrateStepEnd');
    });

    it('dispatches the trigger inside the advance path and after the step reset', () => {
        const region = loadNextStepRegion();
        const reset = region.indexOf('resetForNextStep()');
        const decide = region.indexOf('shouldCelebrateStepEnd(');
        const dispatch = region.indexOf('triggerStepCelebration(');
        expect(reset).toBeGreaterThan(-1);
        expect(decide).toBeGreaterThan(reset);
        expect(dispatch).toBeGreaterThan(decide);
    });
});

describe('StepCelebration mount', () => {
    it('is rendered exactly once by the lesson container', () => {
        expect(container).toContain("import StepCelebration from './widgets/StepCelebration.jsx';");
        expect((container.match(/<StepCelebration \/>/g) || []).length).toBe(1);
    });

    it('holds no logic: no RNG, no scheduler, no confetti options', () => {
        expect(component).toContain('stepCelebrationTrigger');
        expect(component).toContain('runStepCelebration');
        expect(component).toContain('return null');
        expect(component).not.toContain('Math.random');
        expect(component).not.toContain('canvas-confetti');
        expect(component).not.toContain('setTimeout');
        expect(component).not.toContain('particleCount');
    });

    it('does not cancel the scheduled bursts on StrictMode remount', () => {
        // A cleanup would cancel the timers the first effect run scheduled, and
        // the dedupe guard swallows the second run — no celebration in dev.
        expect(component).not.toMatch(/return\s*\(\)\s*=>/);
    });
});

describe('success screen effect is unchanged', () => {
    it('keeps its own score-gated confetti burst', () => {
        expect(successEffects).toContain('shouldShowConfetti');
        expect(successEffects).toContain("import('canvas-confetti')");
        expect(successEffects).toContain('particleCount: 120');
        expect(successEffects).toContain('spread: 80');
        expect(successEffects).toContain('origin: { y: 0.6 }');
    });
});
