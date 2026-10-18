import { describe, it, expect, vi } from 'vitest';
import {
    LANGUAGE_ENDONYMS,
    endonymFor,
    sortLanguagesByEndonym,
} from './language-order.js';
import * as languages from './languages.js';

// Every list the dropdowns render, discovered from the module's exports so a
// fifth exported list cannot escape the coverage guard below. languages.js is a
// pure data module whose only array exports are language lists (its one
// non-array export, LOCALE_MAP, is a code -> locale record), so matching on
// "is an array" needs no name filter.
const EXPORTED_LISTS = Object.entries(languages)
    .filter(([, value]) => Array.isArray(value))
    .map(([name, value]) => ({ name, list: value }));

// The module warns once per unknown code, and that memory is module-level, so a
// test that wants to assert the warning needs a code no earlier test has used.
// Tests that feed an unknown code but are not about the warning silence it.
const silenceWarnings = (run) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        return run();
    } finally {
        warn.mockRestore();
    }
};

const option = (value) => ({ value, label: `${value}-label` });

describe('LANGUAGE_ENDONYMS', () => {
    // The whole convention hangs off these names: they are the sort key, so a
    // misspelling or a name in the wrong language silently reorders a dropdown.
    // Compare against the platform's own endonym, case-insensitively, because
    // CLDR writes some in lower case ("norsk bokmål") and the app capitalizes.
    it('matches the platform endonym for every language it lists', () => {
        expect(typeof Intl.DisplayNames, 'Intl.DisplayNames is required').toBe('function');
        for (const [code, endonym] of Object.entries(LANGUAGE_ENDONYMS)) {
            const display = new Intl.DisplayNames([code.toLowerCase()], {
                type: 'language',
                fallback: 'none',
            }).of(code.toLowerCase());
            expect(display, `${code} is not a language CLDR knows`).toBeTruthy();
            expect(
                endonym.toLowerCase(),
                `${code} endonym does not match the platform (${display})`,
            ).toBe(display.toLowerCase());
        }
    });

    it('has an endonym for every language any dropdown offers', () => {
        expect(EXPORTED_LISTS.map(({ name }) => name)).toEqual(
            expect.arrayContaining(['GUEST_LANGUAGES', 'HOME_LANGUAGES', 'PROFILE_LANGUAGES', 'SIGNUP_LANGUAGES']),
        );
        const offered = new Set(EXPORTED_LISTS.flatMap(({ list }) => list.map(({ value }) => value)));
        expect(offered.size, 'no language lists are exported').toBeGreaterThan(0);
        for (const code of offered) {
            expect(endonymFor(code), `no endonym for ${code}, so its menu slot is arbitrary`).toBeTruthy();
        }
    });

    it('looks up codes case-insensitively and reports unknown ones as empty', () => {
        expect(endonymFor('ES')).toBe('Español');
        expect(endonymFor('es')).toBe('Español');
        expect(endonymFor('XX')).toBe('');
        expect(endonymFor(undefined)).toBe('');
        expect(endonymFor(42)).toBe('');
    });
});

describe('sortLanguagesByEndonym', () => {
    // The convention: alphabetical among Latin-script names, then the remaining
    // scripts in Unicode's fixed order. Pinned here so a change to the order
    // (or a collation regression) has to be a deliberate edit to this test.
    it('alphabetizes Latin names and then follows Unicode script order', () => {
        const sorted = sortLanguagesByEndonym([
            option('HI'), option('ES'), option('JA'), option('DE'), option('FR'),
            option('AR'), option('EN'), option('RU'), option('ZH'), option('KO'),
        ]).map(({ value }) => value);

        expect(sorted).toEqual(['DE', 'EN', 'ES', 'FR', 'RU', 'AR', 'HI', 'KO', 'ZH', 'JA']);
    });

    // The case that rules out a plain code-point / default string sort: Č is
    // U+010C, so sorting by character value strands Czech after every accented
    // name (Svenska, Türkçe). Collation keeps it with the C-names.
    it('sorts accented Latin names by letter, not by code point', () => {
        const accented = [option('TR'), option('CS'), option('SV'), option('DA'), option('PL')];

        expect(sortLanguagesByEndonym(accented).map(({ value }) => value))
            .toEqual(['CS', 'DA', 'PL', 'SV', 'TR']);

        // Proof the code-point order really is different, so this test could not
        // be satisfied by sorting the raw characters: by character value the
        // accented names (Č U+010C, ü, å) all fall after the plain ones, which
        // would put Czech last and Danish/Polish/Swedish in a different order.
        const byCodePoint = accented
            .map(({ value }) => endonymFor(value))
            .sort()
            .map((endonym) => Object.keys(LANGUAGE_ENDONYMS)
                .find((code) => LANGUAGE_ENDONYMS[code] === endonym));
        expect(byCodePoint).not.toEqual(['CS', 'DA', 'PL', 'SV', 'TR']);
    });

    it('sorts by endonym, not by the displayed label', () => {
        // Spanish is labelled "Spanish" in the profile editor but sorts as
        // "Español" — between Deutsch and Français.
        const sorted = sortLanguagesByEndonym([
            { value: 'ES', label: 'Spanish' },
            { value: 'FR', label: 'French' },
            { value: 'DE', label: 'German' },
        ]).map(({ value }) => value);

        expect(sorted).toEqual(['DE', 'ES', 'FR']);
    });

    it('does not mutate its input and returns a new array', () => {
        const input = [option('HI'), option('EN'), option('ES')];
        const snapshot = [...input];
        const sorted = sortLanguagesByEndonym(input);

        expect(input).toEqual(snapshot);
        expect(sorted).not.toBe(input);
        expect(sorted.map(({ value }) => value)).toEqual(['EN', 'ES', 'HI']);
    });

    it('is idempotent — re-sorting a sorted list changes nothing', () => {
        const once = sortLanguagesByEndonym(languages.PROFILE_LANGUAGES);
        expect(sortLanguagesByEndonym(once).map(({ value }) => value))
            .toEqual(once.map(({ value }) => value));
    });

    it('is stable: entries with equal keys keep their relative order', () => {
        // Two unknown codes fall back to their labels; "Same" ties, so both
        // survive in input order rather than one being dropped or shuffled.
        const sorted = silenceWarnings(() => sortLanguagesByEndonym([
            { value: 'XX', label: 'Same' },
            { value: 'ES', label: 'Español' },
            { value: 'YY', label: 'Same' },
        ]));
        expect(sorted.map(({ label }) => label)).toEqual(['Español', 'Same', 'Same']);
    });

    it('keeps an unknown language in the list, ordered by its label', () => {
        const sorted = silenceWarnings(() => sortLanguagesByEndonym([
            { value: 'XX', label: 'Aardvark' },
            { value: 'ES', label: 'Español' },
        ])).map(({ value }) => value);

        expect(sorted).toEqual(['XX', 'ES']);
    });

    it('tolerates missing lists and malformed entries', () => {
        expect(sortLanguagesByEndonym(undefined)).toEqual([]);
        expect(sortLanguagesByEndonym(null)).toEqual([]);
        expect(sortLanguagesByEndonym('Español')).toEqual([]);

        // Nothing is dropped, whatever the input contains.
        const messy = [null, { value: 'ES' }, undefined, { label: 'no code' }];
        const sorted = silenceWarnings(() => sortLanguagesByEndonym(messy));
        expect(sorted).toHaveLength(messy.length);
        for (const entry of messy) {
            expect(sorted).toContain(entry);
        }
    });

    it('warns once per unknown code, instead of sorting it silently', async () => {
        // The fallback keeps the language in the list, but sorting a non-Latin
        // language by its English label drops it into the Latin block — a wrong
        // slot with no other signal, so it has to be loud.
        //
        // A fresh module instance, because "warn once per code" is remembered in
        // module state: reusing this one would pass on a code some earlier test
        // already warned about, and would stop being a test of anything.
        vi.resetModules();
        const { sortLanguagesByEndonym: freshSort } = await import('./language-order.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const unsorted = [{ value: 'QQ', label: 'Something' }, { value: 'ES', label: 'Español' }];
            freshSort(unsorted);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('no endonym for'),
                'QQ',
                expect.stringContaining('sorting it by its label'),
            );
            // Once per code, not once per sort.
            warn.mockClear();
            freshSort(unsorted);
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });
});
