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
// Slices are bounded by the next statement in `processTranscript` (never EOF)
// and assertions are made on raw source, no comment stripping — see AGENTS.md
// "Source-guard tests must be able to fail".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const ORCH = readFileSync(join(here, 'speech-orchestrator.js'), 'utf8');

const sliceBetween = (text, startMarker, endMarker) => {
    const start = text.indexOf(startMarker);
    expect(start).toBeGreaterThan(-1);
    const end = text.indexOf(endMarker, start);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
};

// Each region ends at the next declaration in `processTranscript`, never at
// EOF, so a closure appended later cannot join a slice and satisfy its
// assertions. `restartRegion` stops at the sibling closure rather than the
// review's start marker so it can never span `rejectTranscript` either; the
// reject closure ends where the review is handed over (which is where the
// countdown ticker lives, behind its own gate).
const restartRegion = () => sliceBetween(
    ORCH,
    'const restartTakeAfterReject = () => {',
    'const rejectTranscript = () => {'
);
const rejectRegion = () => sliceBetween(
    ORCH,
    'const rejectTranscript = () => {',
    "console.warn('[PT] CALLING onReviewStart'"
);

describe('re-record wiring guard', () => {
    it('imports the pure decision and its enum from ./rerecord-logic.js', () => {
        const importLine = ORCH.match(/^import \{[^}]*\} from '\.\/rerecord-logic\.js';$/m);
        expect(importLine).not.toBeNull();
        expect(importLine[0]).toContain('decideRerecordAction');
        expect(importLine[0]).toContain('RERECORD_DECISIONS');
    });

    it('calls decideRerecordAction inside restartTakeAfterReject and only re-enters when it says restart', () => {
        const region = restartRegion();

        const gate = region.indexOf('const decision = decideRerecordAction({');
        const bail = region.indexOf('console.warn(\'[Speech] Re-record not started —\', decision);');
        const reentry = region.indexOf('toggleSpeechRecognition(params)');
        expect(gate).toBeGreaterThan(-1);
        expect(bail).toBeGreaterThan(gate);
        expect(reentry).toBeGreaterThan(bail);

        // The re-entry must sit after the refusal branch's `return`, so it can
        // only run once the decision says restart.
        expect(region.slice(bail, reentry)).toContain('return;');

        // Scoped to the region, not the whole file, so a comment quoting the
        // comparison cannot satisfy it.
        expect(region).toMatch(/if \(decision !== RERECORD_DECISIONS\.restart\)/);
    });

    it('restarts the take from rejectTranscript, after onTranscriptRejected', () => {
        const region = rejectRegion();
        // Only the phase ordering is load-bearing: `onTranscriptRejected` must
        // have put the app in `recording/answering` before the mic path is
        // re-entered, otherwise `onRecordingStart` would re-transition.
        expect(region.indexOf('restartTakeAfterReject();'))
            .toBeGreaterThan(region.indexOf('uiHooks?.onTranscriptRejected'));
    });

    it('keeps reviewActive guarding the restart so a second press is inert', () => {
        const region = rejectRegion();
        const latch = region.indexOf('if (!reviewActive) return;');
        expect(latch).toBeGreaterThan(-1);
        expect(latch).toBeLessThan(region.indexOf('restartTakeAfterReject();'));
        // Order alone cannot see a `reviewActive = true` reintroduced between
        // the latch and the restart, so assert the latch sets it exactly once
        // and nothing in the region writes it again.
        expect(region.match(/reviewActive\s*=\s*\w+/g)).toEqual(['reviewActive = false']);
    });
});
