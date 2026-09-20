import { describe, it, expect } from 'vitest';
import {
    ENGINE_SLOW_MS,
    getSpeechUiState,
    classifyMediaError,
    getMediaErrorStringKey,
} from './speech-ui-state.js';

describe('getSpeechUiState', () => {
    it('returns ready as soon as the engine is ready, even if it was slow', () => {
        expect(getSpeechUiState({ isReady: true, isFailed: false, loadingMs: 999999 })).toBe('ready');
    });

    it('returns failed even if the slow threshold has passed', () => {
        expect(getSpeechUiState({ isReady: false, isFailed: true, loadingMs: ENGINE_SLOW_MS + 1 })).toBe('failed');
    });

    it('returns loading below the slow threshold', () => {
        expect(getSpeechUiState({ isReady: false, isFailed: false, loadingMs: ENGINE_SLOW_MS - 1 })).toBe('loading');
    });

    it('returns slow at/after the slow threshold', () => {
        expect(getSpeechUiState({ isReady: false, isFailed: false, loadingMs: ENGINE_SLOW_MS })).toBe('slow');
    });

    it('defaults to loading with no args', () => {
        expect(getSpeechUiState()).toBe('loading');
    });
});

describe('classifyMediaError', () => {
    it('maps missing devices to not_found', () => {
        expect(classifyMediaError({ name: 'NotFoundError' })).toBe('not_found');
        expect(classifyMediaError({ name: 'DevicesNotFoundError' })).toBe('not_found');
    });

    it('maps permission blocks to denied', () => {
        expect(classifyMediaError({ name: 'NotAllowedError' })).toBe('denied');
        expect(classifyMediaError({ name: 'PermissionDeniedError' })).toBe('denied');
        expect(classifyMediaError({ name: 'SecurityError' })).toBe('denied');
    });

    it('maps device-in-use failures to busy', () => {
        expect(classifyMediaError({ name: 'NotReadableError' })).toBe('busy');
        expect(classifyMediaError({ name: 'TrackStartError' })).toBe('busy');
        expect(classifyMediaError({ name: 'AbortError' })).toBe('busy');
    });

    it('falls back to generic', () => {
        expect(classifyMediaError(new Error('boom'))).toBe('generic');
        expect(classifyMediaError(undefined)).toBe('generic');
    });
});

describe('getMediaErrorStringKey', () => {
    it('returns the actionable key per cause', () => {
        expect(getMediaErrorStringKey({ name: 'NotFoundError' })).toBe('error_media_not_found');
        expect(getMediaErrorStringKey({ name: 'NotAllowedError' })).toBe('error_media_denied');
        expect(getMediaErrorStringKey({ name: 'NotReadableError' })).toBe('error_media_busy');
        expect(getMediaErrorStringKey({ name: 'SomethingElse' })).toBe('error_media_generic');
    });
});
