import { describe, it, expect } from 'vitest';
import { splitItalicSegments } from './home-landing-logic.js';

describe('splitItalicSegments', () => {
    it('returns plain text as a single non-italic segment', () => {
        expect(splitItalicSegments('100% free')).toEqual([{ text: '100% free', italic: false }]);
    });

    it('splits one <i> span into three segments', () => {
        expect(splitItalicSegments('UFF stands for Ultra <i>Fast</i> Fluency in English')).toEqual([
            { text: 'UFF stands for Ultra ', italic: false },
            { text: 'Fast', italic: true },
            { text: ' Fluency in English', italic: false },
        ]);
    });

    it('handles markup at the start and end', () => {
        expect(splitItalicSegments('<i>Fast</i> start')).toEqual([
            { text: 'Fast', italic: true },
            { text: ' start', italic: false },
        ]);
        expect(splitItalicSegments('end <i>Fast</i>')).toEqual([
            { text: 'end ', italic: false },
            { text: 'Fast', italic: true },
        ]);
    });

    it('contains no raw brackets for well-formed input', () => {
        for (const seg of splitItalicSegments('a <i>b</i> c')) {
            expect(seg.text).not.toContain('<');
            expect(seg.text).not.toContain('>');
        }
    });

    it('treats nullish input as empty', () => {
        expect(splitItalicSegments(null)).toEqual([]);
        expect(splitItalicSegments(undefined)).toEqual([]);
    });
});
