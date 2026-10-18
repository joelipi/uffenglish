// Source guards for the single-press re-record wiring.
//
// The behaviour itself is covered behaviourally by
// `speech-orchestrator.test.js` ("re-record restarts the take"). These guards
// pin the structural facts the runtime tests cannot observe from inside this
// module: that the re-entry sits inside `rejectTranscript`, *after* the
// `decideRerecordAction` gate, and that the `reviewActive` latch is still the
// only thing standing between a double ✕ and a second deduction.
//
// The store's `review → recording/answering` transition is asserted
// behaviourally where it belongs instead: `store.test.js` drives
// `transitionTo` directly, which fails if the table changes rather than only
// if its literal text does.
//
// Slices are bounded by the next top-level marker and assertions are made on
// raw source (no comment stripping — see AGENTS.md "Source-guard tests must be
// able to fail").
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const ORCH = readFileSync(join(here, 'speech-orchestrator.js'), 'utf8');

describe('re-record wiring guard', () => {
    it('imports the pure decision from ./rerecord-logic.js', () => {
        expect(ORCH).toMatch(/import\s*\{\s*decideRerecordAction\s*\}\s*from\s*'\.\/rerecord-logic\.js'/);
    });

    it('calls decideRerecordAction inside restartTakeAfterReject and only re-enters when it says restart', () => {
        const start = ORCH.indexOf('const restartTakeAfterReject = () => {');
        expect(start).toBeGreaterThan(-1);
        // Bound the slice at the next top-level marker so a function appended
        // later cannot silently join it and satisfy the assertions.
        const end = ORCH.indexOf('console.warn(\'[PT] CALLING onReviewStart\'', start);
        expect(end).toBeGreaterThan(start);
        const region = ORCH.slice(start, end);

        const gate = region.indexOf('const { restart, decision } = decideRerecordAction({');
        const bail = region.indexOf('console.warn(\'[Speech] Re-record not started —\', decision);');
        const reentry = region.indexOf('toggleSpeechRecognition(params)');
        expect(gate).toBeGreaterThan(-1);
        expect(bail).toBeGreaterThan(gate);
        expect(reentry).toBeGreaterThan(bail);

        // The re-entry must be inside the `if (!restart) { … return; }` guard's
        // negative branch — i.e. after the `return`.
        expect(region.slice(bail, reentry)).toContain('return;');
    });

    it('restarts the take from rejectTranscript, after onTranscriptRejected', () => {
        const start = ORCH.indexOf('const rejectTranscript = () => {');
        expect(start).toBeGreaterThan(-1);
        const end = ORCH.indexOf("console.warn('[PT] CALLING onReviewStart'", start);
        expect(end).toBeGreaterThan(start);
        const region = ORCH.slice(start, end);

        // Only the phase ordering is load-bearing here: `onTranscriptRejected`
        // must have put the app in `recording/answering` before the mic path is
        // re-entered, otherwise `onRecordingStart` would re-transition.
        expect(region.indexOf('restartTakeAfterReject();'))
            .toBeGreaterThan(region.indexOf('uiHooks?.onTranscriptRejected'));
    });

    it('keeps reviewActive guarding the restart so a second press is inert', () => {
        const start = ORCH.indexOf('const rejectTranscript = () => {');
        const end = ORCH.indexOf("console.warn('[PT] CALLING onReviewStart'", start);
        const region = ORCH.slice(start, end);
        const latch = region.indexOf('if (!reviewActive) return;');
        expect(latch).toBeGreaterThan(-1);
        expect(latch).toBeLessThan(region.indexOf('restartTakeAfterReject();'));
        // Order alone cannot see a `reviewActive = true` reintroduced between
        // the latch and the restart, so assert the latch sets it exactly once
        // and nothing in the region writes it again.
        expect(region.match(/reviewActive\s*=\s*\w+/g)).toEqual(['reviewActive = false']);
    });
});
