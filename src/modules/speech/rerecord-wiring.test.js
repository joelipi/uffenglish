// Source guards for the single-press re-record wiring.
//
// The behaviour itself is covered behaviourally by
// `speech-orchestrator.test.js` ("re-record restarts the take"). These guards
// pin the two structural facts the runtime tests cannot observe from outside
// this module: that the re-entry sits inside `rejectTranscript` and *after* the
// `decideRerecordAction` gate, and that the store treats
// `review → recording/answering` as a legal transition.
//
// Slices are bounded by the next top-level marker and assertions are made on
// raw source (no comment stripping — see AGENTS.md "Source-guard tests must be
// able to fail").
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const ORCH_PATH = join(here, 'speech-orchestrator.js');
const STORE_PATH = join(here, '..', 'store', 'store.js');

const ORCH = readFileSync(ORCH_PATH, 'utf8');
const STORE = readFileSync(STORE_PATH, 'utf8');

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

        const hook = region.indexOf('uiHooks?.onTranscriptRejected');
        const restart = region.indexOf('restartTakeAfterReject();');
        expect(hook).toBeGreaterThan(-1);
        // The phase must already be `recording/answering` before the mic path is
        // re-entered, otherwise onRecordingStart would re-transition.
        expect(restart).toBeGreaterThan(hook);
        expect(restart).toBeGreaterThan(region.indexOf('updateSpeechRecording('));
    });

    it('keeps reviewActive guarding the restart so a second press is inert', () => {
        const start = ORCH.indexOf('const rejectTranscript = () => {');
        const end = ORCH.indexOf("console.warn('[PT] CALLING onReviewStart'", start);
        const region = ORCH.slice(start, end);
        const latch = region.indexOf('if (!reviewActive) return;');
        const restart = region.indexOf('restartTakeAfterReject();');
        expect(latch).toBeGreaterThan(-1);
        expect(latch).toBeLessThan(restart);
        // Order alone cannot see a `reviewActive = true` reintroduced between
        // the latch and the restart, so assert the latch sets it exactly once
        // and nothing in the region writes it again.
        expect(region.match(/reviewActive\s*=\s*\w+/g)).toEqual(['reviewActive = false']);
    });
});

describe('review phase transition guard', () => {
    it('allows review → recording/answering without an unexpected-transition warning', () => {
        // Match the `answerFlowTransitions` entry by shape, not by column
        // alignment — `phaseMapping` has an identically aligned `review:` line
        // whose value is an object literal, so the `[` keeps the two apart and
        // a re-aligned table cannot silently break this guard.
        const match = STORE.match(/^\s*review:\s*\[[^\]]*\]/m);
        expect(match).not.toBeNull();
        expect(match[0]).toContain("'recording/answering'");
    });
});
