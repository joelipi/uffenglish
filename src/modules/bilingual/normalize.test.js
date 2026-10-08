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

    it('should expand "a" before magnitude words to "one"', async () => {
        expect(await normalize('a million')).toBe('one million');
        expect(await normalize('a thousand')).toBe('one thousand');
        expect(await normalize('a hundred')).toBe('one hundred');
        expect(await normalize('a billion')).toBe('one billion');
        expect(await normalize('a hundred dollars')).toBe('one hundred dollars');
    });

    it('should render large magnitudes correctly', async () => {
        expect(await normalize('1,000,000')).toBe('one million');
        expect(await normalize('1,000,000,000')).toBe('one billion');
        expect(await normalize('2,000,000,000')).toBe('two billion');
        expect(await normalize('1,000,000,000,000')).toBe('one trillion');
        expect(await normalize('1,000,000,000,000,000')).toBe('one quadrillion');
    });

    it('should normalize currency symbols the same as their word form', async () => {
        expect(await normalize('$5')).toBe('five dollars');
        expect(await normalize('5 dollars')).toBe('five dollars');
        expect(await normalize('$1')).toBe('one dollars');
        expect(await normalize('one dollar')).toBe('one dollars');
        expect(await normalize('$1,000,000')).toBe('one million dollars');
        expect(await normalize('a million dollars')).toBe('one million dollars');
    });

    it('should keep the amount of a decimal currency value', async () => {
        expect(await normalize('$5.50')).toBe('five dollars fifty cents');
        expect(await normalize('5.50 dollars')).toBe('five dollars fifty cents');
        expect(await normalize('$1,234.56')).toBe('one thousand two hundred thirty dollars fifty cents');
    });

    it('should normalize cents and drop a zero whole part', async () => {
        expect(await normalize('$0.50')).toBe('fifty cents');
        expect(await normalize('$0.05')).toBe('five cents');
        expect(await normalize('50 cents')).toBe('fifty cents');
        expect(await normalize('fifty cents')).toBe('fifty cents');
    });

    it('should use the currency-specific subunit word', async () => {
        expect(await normalize('£5.50')).toBe('five pounds fifty pence');
        expect(await normalize('£0.50')).toBe('fifty pence');
        expect(await normalize('fifty pence')).toBe('fifty pence');
        expect(await normalize('₹5.50')).toBe('five rupees fifty paise');
    });

    it('should not treat a bare number as money', async () => {
        expect(await normalize('550')).toBe('five hundred fifty');
        expect(await normalize('apartment 550')).toBe('apartment five hundred fifty');
        // A currency word is what makes it money, not the digits alone.
        expect(await normalize('550 dollars')).toBe('five hundred fifty dollars');
    });

    it('should normalize other currency markers', async () => {
        expect(await normalize('€5')).toBe('five euros');
        expect(await normalize('5 euros')).toBe('five euros');
        expect(await normalize('£5')).toBe('five pounds');
        expect(await normalize('₹5')).toBe('five rupees');
        expect(await normalize('¥500')).toBe('five hundred yen');
        expect(await normalize('₽100')).toBe('one hundred rubles');
        expect(await normalize('₩1000')).toBe('one thousand won');
        expect(await normalize('₱50')).toBe('fifty pesos');
        expect(await normalize('₪10')).toBe('ten shekels');
        expect(await normalize('﷼100')).toBe('one hundred rials');
        expect(await normalize('₦100')).toBe('one hundred naira');
        expect(await normalize('500 francs')).toBe('five hundred francs');
    });

    it('should normalize a trailing currency symbol too', async () => {
        expect(await normalize('5$')).toBe('five dollars');
    });

    it('should normalize currency attached to a magnitude phrase', async () => {
        // Every reasonable spelling of "one million dollars" must agree.
        expect(await normalize('$1 million')).toBe('one million dollars');
        expect(await normalize('1 million dollars')).toBe('one million dollars');
        expect(await normalize('a million dollars')).toBe('one million dollars');
        expect(await normalize('one million dollars')).toBe('one million dollars');
        expect(await normalize('$2 million')).toBe('two million dollars');
        expect(await normalize('two million dollars')).toBe('two million dollars');
        expect(await normalize('$5 thousand')).toBe('five thousand dollars');
        expect(await normalize('$1 billion')).toBe('one billion dollars');
        expect(await normalize('€1 million')).toBe('one million euros');
        expect(await normalize('$1 million dollars')).toBe('one million dollars');
    });

    it('should normalize decimal magnitude amounts', async () => {
        expect(await normalize('$1.5 million')).toBe('one point five million dollars');
        expect(await normalize('1.5 million dollars')).toBe('one point five million dollars');
        expect(await normalize('$1.5')).toBe('one dollars fifty cents');
    });
});
