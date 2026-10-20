// Unit tests for the display label of a course topic (the English word first,
// the learner's language after it).
import { describe, it, expect } from 'vitest';
import {
    COURSE_TAG_STRING_PREFIX,
    courseTagStringKey,
    courseTagTranslation,
    courseTagLabelParts,
} from './course-tag-labels.js';

describe('courseTagStringKey', () => {
    it('derives the strings-table key from the topic', () => {
        expect(courseTagStringKey('travel')).toBe('course_tag_travel');
        expect(courseTagStringKey('Travel')).toBe('course_tag_travel');
        expect(courseTagStringKey('  music  ')).toBe('course_tag_music');
    });

    it('replaces the spaces of a multi-word topic with underscores', () => {
        expect(courseTagStringKey('getting to know you')).toBe('course_tag_getting_to_know_you');
    });

    it('is empty for a blank topic', () => {
        expect(courseTagStringKey('')).toBe('');
        expect(courseTagStringKey('   ')).toBe('');
        expect(courseTagStringKey(undefined)).toBe('');
        expect(COURSE_TAG_STRING_PREFIX).toBe('course_tag_');
    });
});

describe('courseTagTranslation', () => {
    it('returns the locale map of a known topic', () => {
        const entry = courseTagTranslation('travel');
        expect(entry.en).toBe('Travel');
        expect(entry.es).toBe('Viajes');
        expect(entry.pt).toBe('Viagens');
        expect(entry.fr).toBe('Voyage');
    });

    it('is null for a topic with no entry in the strings table', () => {
        expect(courseTagTranslation('unicorns')).toBeNull();
        expect(courseTagTranslation('')).toBeNull();
    });
});

describe('courseTagLabelParts', () => {
    it('puts the English word first and the learner\'s language after it', () => {
        expect(courseTagLabelParts('travel', 'es')).toEqual({ english: 'Travel', localized: 'Viajes' });
        expect(courseTagLabelParts('travel', 'hi')).toEqual({ english: 'Travel', localized: 'यात्रा' });
    });

    it('shows only the English word for an English learner', () => {
        expect(courseTagLabelParts('travel', 'en')).toEqual({ english: 'Travel', localized: '' });
    });

    it('reads a regional language code as its base language', () => {
        expect(courseTagLabelParts('travel', 'es-MX').localized).toBe('Viajes');
    });

    it('falls back to the topic itself when there is no translation', () => {
        expect(courseTagLabelParts('unicorns', 'es')).toEqual({ english: 'unicorns', localized: '' });
    });

    it('is empty for a blank topic', () => {
        expect(courseTagLabelParts('', 'es')).toEqual({ english: '', localized: '' });
        expect(courseTagLabelParts(undefined, 'es')).toEqual({ english: '', localized: '' });
    });
});
