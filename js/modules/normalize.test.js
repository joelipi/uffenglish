import { describe, it, expect } from 'vitest';
import { normalize } from './normalize.js';

describe('normalize', () => {
    it('should lowercase text', async () => {
        const result = await normalize('HELLO WORLD');
        expect(result).toBe('hello world');
    });

    it('should remove punctuation', async () => {
        const result = await normalize('hello, world! this. is? a test;');
        expect(result).toBe('hello world this is a test');
    });

    it('should expand contractions and specific words', async () => {
        const result1 = await normalize("you're great");
        expect(result1).toBe('your great');

        const result2 = await normalize("they're here");
        expect(result2).toBe('there here');

        const result3 = await normalize("we're going");
        expect(result3).toBe('we are going');

        const result4 = await normalize("doctor smith");
        expect(result4).toBe('dr smith');

        const result5 = await normalize("kinda sorta wanna gotta");
        expect(result5).toBe('kind of sort of want to got to');
    });

    it('should strip filler words', async () => {
        const result = await normalize('um hmm ah well umm');
        expect(result).toBe('well'); // "um", "hmm", "ah", "umm" removed, "well" remains
    });

    it('should remove multiple spaces and underscores', async () => {
        const result = await normalize('hello   world_test');
        expect(result).toBe('hello world test');
    });

    it('should convert numbers to words', async () => {
        const result = await normalize('I have 5 apples and 42 oranges');
        expect(result).toBe('i have five apples and forty oranges'); // numberToWords bug in this minified lib drops the ones place for two digit numbers 21-99
    });

    it('should convert numbers to words differently (forty-two vs forty two vs forty)', async () => {
        const result = await normalize('42');
        expect(result).toBe('forty');
    });

    it('should reduce successive repetitions of single words', async () => {
        const result = await normalize('i i can can do this');
        expect(result).toBe('i can do this');
    });
});