import { describe, it, expect } from 'vitest';
import {
    GO_LESSON_PATH,
    normalizeShareCode,
    planShareCodeSubmit,
    shareCodeErrorStringKey,
} from './share-code-entry-logic.js';

describe('normalizeShareCode', () => {
    it('returns an already-lowercase code unchanged', () => {
        expect(normalizeShareCode('abc123')).toBe('abc123');
    });

    it('trims whitespace and lowercases', () => {
        expect(normalizeShareCode('  ABC123  ')).toBe('abc123');
    });

    it('returns null for empty or non-string input', () => {
        expect(normalizeShareCode('')).toBeNull();
        expect(normalizeShareCode('   ')).toBeNull();
        expect(normalizeShareCode(null)).toBeNull();
        expect(normalizeShareCode(undefined)).toBeNull();
        expect(normalizeShareCode(42)).toBeNull();
    });
});

describe('planShareCodeSubmit', () => {
    it('navigates to the normalized code when a profile resolves', () => {
        expect(planShareCodeSubmit({ rawCode: 'abc123', profile: { id: 'u1' } }))
            .toEqual({ action: 'navigate', to: '/abc123' });
    });

    it('uses the normalized code in the path', () => {
        expect(planShareCodeSubmit({ rawCode: '  ABC  ', profile: { id: 'u1' } }))
            .toEqual({ action: 'navigate', to: '/abc' });
    });

    it('errors not_found when the profile is null', () => {
        expect(planShareCodeSubmit({ rawCode: 'abc123', profile: null }))
            .toEqual({ action: 'error', reason: 'not_found' });
    });

    it('errors empty for a blank code even with a profile', () => {
        expect(planShareCodeSubmit({ rawCode: '   ', profile: { id: 'u1' } }))
            .toEqual({ action: 'error', reason: 'empty' });
    });

    it('errors empty with no arguments', () => {
        expect(planShareCodeSubmit()).toEqual({ action: 'error', reason: 'empty' });
    });
});

describe('GO_LESSON_PATH', () => {
    it('points at the Would You Rather ask lesson', () => {
        expect(GO_LESSON_PATH).toBe('/course/wouldrather/lesson/a');
    });
});

describe('shareCodeErrorStringKey', () => {
    it('maps each known reason to its string key', () => {
        expect(shareCodeErrorStringKey('empty')).toBe('home_landing_code_required');
        expect(shareCodeErrorStringKey('not_found')).toBe('home_landing_code_not_found');
        expect(shareCodeErrorStringKey('lookup_failed')).toBe('home_landing_lookup_error');
    });

    it('falls back to the lookup error for an unknown reason', () => {
        expect(shareCodeErrorStringKey('nonsense')).toBe('home_landing_lookup_error');
        expect(shareCodeErrorStringKey(undefined)).toBe('home_landing_lookup_error');
    });
});
