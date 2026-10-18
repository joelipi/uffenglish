import { describe, it, expect } from 'vitest';
import { decideRerecordAction, RERECORD_DECISIONS } from './rerecord-logic.js';

describe('decideRerecordAction', () => {
    it('restarts when no take is rolling and the orchestrator lock is free', () => {
        expect(decideRerecordAction({ listeningActive: false, transitioning: false }))
            .toBe(RERECORD_DECISIONS.restart);
    });

    it('restarts when no flags are supplied at all', () => {
        expect(decideRerecordAction()).toBe(RERECORD_DECISIONS.restart);
    });

    it('refuses while a take is still rolling (a re-entry would stop it)', () => {
        expect(decideRerecordAction({ listeningActive: true, transitioning: false }))
            .toBe(RERECORD_DECISIONS.alreadyRecording);
    });

    it('refuses while the orchestrator start/stop lock is still held', () => {
        expect(decideRerecordAction({ listeningActive: false, transitioning: true }))
            .toBe(RERECORD_DECISIONS.transitioning);
    });

    it('reports the recording as the reason even when the lock is also held', () => {
        // The already-recording reason is the actionable one: the take would be
        // aborted by a re-entry, so it must win over the mutex explanation.
        expect(decideRerecordAction({ listeningActive: true, transitioning: true }))
            .toBe(RERECORD_DECISIONS.alreadyRecording);
    });

    it('returns only known decisions, so a caller can compare against the enum', () => {
        for (const flags of [{}, { listeningActive: true }, { transitioning: true },
            { listeningActive: true, transitioning: true }]) {
            expect(Object.values(RERECORD_DECISIONS)).toContain(decideRerecordAction(flags));
        }
    });
});
