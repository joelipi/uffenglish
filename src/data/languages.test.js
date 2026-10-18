import { describe, it, expect } from 'vitest';
import { GUEST_LANGUAGES, PROFILE_LANGUAGES, SIGNUP_LANGUAGES, HOME_LANGUAGES, LOCALE_MAP } from './languages.js';
import { sortLanguagesByEndonym, endonymFor } from './language-order.js';

const LISTS = { GUEST_LANGUAGES, PROFILE_LANGUAGES, SIGNUP_LANGUAGES };

describe('language selection lists', () => {
    it.each(Object.keys(LISTS))('%s includes Hindi (HI)', (name) => {
        expect(LISTS[name].some((l) => l.value === 'HI')).toBe(true);
    });

    it.each(Object.keys(LISTS))('%s includes Bengali (BN)', (name) => {
        expect(LISTS[name].some((l) => l.value === 'BN')).toBe(true);
    });

    it.each(Object.keys(LISTS))('%s has no duplicate values', (name) => {
        const values = LISTS[name].map((l) => l.value);
        expect(new Set(values).size).toBe(values.length);
    });

    it.each(Object.keys(LISTS))('%s has non-empty labels', (name) => {
        for (const l of LISTS[name]) {
            expect(l.label, `empty label for ${l.value}`).toBeTruthy();
        }
    });

    it('labels Bengali in its native script', () => {
        expect(GUEST_LANGUAGES.find((l) => l.value === 'BN').label).toBe('বাংলা (Bengali)');
        expect(SIGNUP_LANGUAGES.find((l) => l.value === 'BN').label).toBe('বাংলা (Bengali)');
        expect(PROFILE_LANGUAGES.find((l) => l.value === 'BN').label).toBe('Bengali');
    });

    it('removes English from the guest dropdown only', () => {
        expect(GUEST_LANGUAGES.some((l) => l.value === 'EN')).toBe(false);
        expect(GUEST_LANGUAGES.some((l) => l.label === 'English')).toBe(false);
        expect(PROFILE_LANGUAGES.some((l) => l.value === 'EN')).toBe(true);
        expect(SIGNUP_LANGUAGES.some((l) => l.value === 'EN')).toBe(true);
    });

    it('keeps the other guest options', () => {
        for (const code of ['ES', 'HI', 'BN']) {
            expect(GUEST_LANGUAGES.some((l) => l.value === code), `missing ${code}`).toBe(true);
        }
    });
});

describe('HOME_LANGUAGES', () => {
    it('lists the six homepage languages in endonym order, English first', () => {
        expect(HOME_LANGUAGES.map((l) => l.value)).toEqual(['EN', 'ES', 'FR', 'PT', 'HI', 'BN']);
    });

    it('includes English (unlike GUEST_LANGUAGES)', () => {
        expect(HOME_LANGUAGES.some((l) => l.value === 'EN')).toBe(true);
    });

    it('has unique values and non-empty labels', () => {
        const values = HOME_LANGUAGES.map((l) => l.value);
        expect(new Set(values).size).toBe(values.length);
        for (const l of HOME_LANGUAGES) {
            expect(l.label, `empty label for ${l.value}`).toBeTruthy();
        }
    });

    it('uses native-only labels so the homepage dropdown stays narrow', () => {
        expect(HOME_LANGUAGES.map((l) => l.label)).toEqual([
            'English',
            'Español',
            'Français',
            'Português',
            'हिन्दी',
            'বাংলা',
        ]);
        for (const l of HOME_LANGUAGES) {
            expect(l.label, `English gloss for ${l.value}`).not.toContain('(');
        }
    });
});

// The menus are all read by learners looking for their own language, so they are
// ordered by the shared convention (endonym, Unicode default collation — see
// language-order.js) rather than by whatever order the entries were typed in.
describe('menu order', () => {
    const ALL_LISTS = { ...LISTS, HOME_LANGUAGES };

    it.each(Object.keys(ALL_LISTS))('%s is in the conventional endonym order', (name) => {
        expect(ALL_LISTS[name].map((l) => l.value)).toEqual(
            sortLanguagesByEndonym(ALL_LISTS[name]).map((l) => l.value),
        );
    });

    // Pinned orders: the exact sequence a learner sees in each dropdown. The
    // guest modal and the signup form are the two that were visibly unordered.
    it.each([
        ['GUEST_LANGUAGES', GUEST_LANGUAGES, 'DE ES FR IT NL PL PT SV VI TR RU AR HI BN TH KO ZH JA'],
        ['SIGNUP_LANGUAGES', SIGNUP_LANGUAGES, 'DE EN ES FR PT HI BN KO'],
        ['PROFILE_LANGUAGES', PROFILE_LANGUAGES, 'CS DA DE EN ES FR IT HU NL NB PL PT RO FI SV VI TR EL RU UK AR HI BN TH KO ZH JA'],
    ])('%s lists its languages in order', (_name, list, expected) => {
        expect(list.map((l) => l.value).join(' ')).toBe(expected);
    });

    it('groups every non-Latin language into a single trailing block', () => {
        // The bug this fixes: Hindi sat between Arabic and Bengali in a list
        // whose Latin names were in no order at all. Each script now forms one
        // contiguous block, so a learner can scan straight to their script and
        // then to their language inside it.
        const isLatin = (code) => /^\p{Script=Latin}([\p{Script=Latin}\s])*$/u.test(endonymFor(code));
        for (const [name, list] of Object.entries(ALL_LISTS)) {
            const scripts = list.map(({ value }) => (isLatin(value) ? 'latin' : 'other'));
            // A block starts wherever the script differs from the previous entry;
            // if a script ever reappeared, there would be more blocks than
            // distinct scripts.
            const blocks = scripts.filter((s, i) => s !== scripts[i - 1]);
            expect(blocks, `${name} interleaves scripts: ${scripts.join(',')}`)
                .toEqual([...new Set(scripts)]);
        }
    });
});

describe('LOCALE_MAP', () => {
    it('maps every PROFILE_LANGUAGES code to its lowercase BCP-47 tag', () => {
        for (const { value } of PROFILE_LANGUAGES) {
            expect(LOCALE_MAP[value], `missing locale for ${value}`).toBe(value.toLowerCase());
        }
    });

    it('covers Hindi and Bengali', () => {
        expect(LOCALE_MAP.HI).toBe('hi');
        expect(LOCALE_MAP.BN).toBe('bn');
    });

    it('has no entries outside PROFILE_LANGUAGES (cannot drift)', () => {
        const codes = new Set(PROFILE_LANGUAGES.map((l) => l.value));
        for (const code of Object.keys(LOCALE_MAP)) {
            expect(codes.has(code), `stray locale key ${code}`).toBe(true);
        }
    });
});
