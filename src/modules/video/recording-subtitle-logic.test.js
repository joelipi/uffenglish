import { describe, it, expect } from 'vitest';
import { getRecordingPhraseOverlay } from './recording-subtitle-logic.js';

describe('getRecordingPhraseOverlay', () => {
    it('returns null for non-friendClosedResponse steps', () => {
        expect(getRecordingPhraseOverlay({ responseType: 'closedResponse', cue: 'hi' })).toBeNull();
        expect(getRecordingPhraseOverlay(null)).toBeNull();
    });

    it('extracts the English phrase for a friendClosedResponse step', () => {
        const step = { responseType: 'friendClosedResponse', cue: { en: 'Hello world', es: 'Hola' } };
        expect(getRecordingPhraseOverlay(step)).toEqual({ phrase: 'Hello world' });
    });

    it('handles array cues by taking the first variant', () => {
        const step = { responseType: 'friendClosedResponse', cue: [{ en: 'A' }, { en: 'B' }] };
        expect(getRecordingPhraseOverlay(step)).toEqual({ phrase: 'A' });
    });

    it('returns null when the phrase is empty', () => {
        const step = { responseType: 'friendClosedResponse', cue: null };
        expect(getRecordingPhraseOverlay(step)).toBeNull();
    });
});
