import { describe, it, expect } from 'vitest';
import { decideRerecordAction, RERECORD_DECISIONS } from './rerecord-logic.js';

describe('decideRerecordAction', () => {
    it('restarts when no take is rolling and the orchestrator lock is free', () => {
        expect(decideRerecordAction({ listeningActive: false, transitioning: false }))
            .toEqual({ restart: true, decision: RERECORD_DECISIONS.restart });
    });

    it('restarts when no flags are supplied at all', () => {
        expect(decideRerecordAction())
            .toEqual({ restart: true, decision: RERECORD_DECISIONS.restart });
    });

    it('refuses while a take is still rolling (a re-entry would stop it)', () => {
        expect(decideRerecordAction({ listeningActive: true, transitioning: false }))
            .toEqual({ restart: false, decision: RERECORD_DECISIONS.alreadyRecording });
    });

    it('refuses while the orchestrator start/stop lock is still held', () => {
        expect(decideRerecordAction({ listeningActive: false, transitioning: true }))
            .toEqual({ restart: false, decision: RERECORD_DECISIONS.transitioning });
    });

    it('reports the recording as the reason even when the lock is also held', () => {
        // The already-recording reason is the actionable one: the take would be
        // aborted by a re-entry, so it must win over the mutex explanation.
        expect(decideRerecordAction({ listeningActive: true, transitioning: true }).decision)
            .toBe(RERECORD_DECISIONS.alreadyRecording);
    });
});
