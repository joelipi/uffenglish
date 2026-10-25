// Guards for the success fireworks wiring (stories/095-celebration-app-palette).
//
// The component must not grow its own burst again: the sizes, lifetimes and
// palette live in the pure planner, and every volley has to be scheduled.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const raw = readFileSync(path.join(ROOT, 'src/components/widgets/SuccessEffects.jsx'), 'utf8');

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the success effects fire the shared plan', () => {
    it('imports the planner', () => {
        expect(raw).toContain('buildSuccessFireworkPlan');
        expect(raw).toContain("from '../../modules/lesson/success-fireworks-logic.js';");
    });

    it('schedules every volley from the plan', () => {
        const stripped = stripComments(raw);
        expect(stripped).toContain('buildSuccessFireworkPlan()');
        expect(stripped).toContain('.forEach((burst) =>');
        expect(stripped).toContain('confetti(burst.options)');
        expect(stripped).toContain('burst.delayMs');
    });

    it('no longer hard-codes its own rainbow burst', () => {
        const stripped = stripComments(raw);
        expect(stripped).not.toContain('particleCount: 120');
        expect(stripped).not.toContain('spread: 80');
    });

    it('cancels the scheduled volleys on unmount or an effect re-run', () => {
        const stripped = stripComments(raw);
        expect(stripped).toContain('let cancelled = false;');
        expect(stripped).toContain('const volleyTimers = [];');
        expect(stripped).toContain('volleyTimers.push(setTimeout(');
        expect(stripped).toContain('return () => {');
        expect(stripped).toContain('clearTimeout(timer)');
        // A late-resolving import must not schedule after teardown, and a volley
        // already queued must not fire.
        expect(stripped.match(/if \(cancelled\) return;/g).length).toBeGreaterThanOrEqual(2);
    });

    it('keeps the grading gate and the completion sound', () => {
        const stripped = stripComments(raw);
        expect(stripped).toContain('shouldShowConfetti(fluencyData.total)');
        expect(stripped).toContain("Media.playSound('lesson-complete-sound')");
    });
});
