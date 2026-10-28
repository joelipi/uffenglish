import { describe, it, expect, vi } from 'vitest';
import {
    HERO_CEFR_LEVELS,
    HERO_HEADLINE_LANGS,
    HERO_HEADLINE_TEMPLATES,
    HERO_LEVEL_OFFSET,
    HERO_REDUCED_MOTION_QUERY,
    HERO_RELATIONS,
    heroFriendLevels,
    heroHeadlineSegments,
    heroHeadlineTemplate,
    heroHeadlineText,
    heroRelations,
    heroSlotIndex,
    heroSlotValues,
    heroYourLevels,
    normalizeHeroLang,
    readPrefersReducedMotion,
    resolveHeroHeadline,
} from './hero-headline-logic.js';

const DEVANAGARI = /[\u0900-\u097F]/;
const BENGALI = /[\u0980-\u09FF]/;

const SLOT_TOKENS = ['{relation}', '{friendLevel}', '{yourLevel}'];

describe('normalizeHeroLang', () => {
    it('lowercases and strips a region tag', () => {
        expect(normalizeHeroLang('ES')).toBe('es');
        expect(normalizeHeroLang('es-MX')).toBe('es');
        expect(normalizeHeroLang('BN_BD')).toBe('bn');
        expect(normalizeHeroLang(' en ')).toBe('en');
    });

    it('falls back to English for a language we do not translate', () => {
        for (const lang of ['de', 'zh', 'ar', undefined, null, '', 42, 'OTHER', 'other']) {
            expect(normalizeHeroLang(lang), String(lang)).toBe('en');
        }
    });
});

describe('hero headline segments', () => {
    it('splits the English sentence into text and three rotating slots', () => {
        expect(heroHeadlineSegments('en').map((segment) => segment.kind)).toEqual([
            'text', 'slot', 'text', 'slot', 'text', 'slot', 'text',
        ]);
        expect(heroHeadlineSegments('en')
            .filter((segment) => segment.kind === 'slot')
            .map((segment) => segment.slot)).toEqual(['relation', 'friendLevel', 'yourLevel']);
    });

    it('keeps every template token — no locale may drop a placeholder', () => {
        for (const lang of HERO_HEADLINE_LANGS) {
            for (const token of SLOT_TOKENS) {
                expect(HERO_HEADLINE_TEMPLATES[lang], `${lang} ${token}`).toContain(token);
            }
            expect(heroHeadlineText(lang)).not.toContain('{');
        }
    });

    it('renders the original Spanish sentence the feature was conceived in', () => {
        expect(heroHeadlineText('es')).toBe(
            'Practica inglés 🗣️ en 5 min con tu mamá, aunque sea A0 y tú B1 — ¡sin estar conectados al mismo tiempo!',
        );
    });

    it('renders the English default with the first relationship and band pair', () => {
        expect(heroHeadlineText('en')).toBe(
            "Practice English 🗣️ in 5 min with your mom, even if they're A0 and you're B1 — without being online at the same time!",
        );
    });

    it('marks the rotating part so the renderer never reflows the line', () => {
        // Every slot keeps all its candidates, so a longer word can be stacked.
        const relation = heroHeadlineSegments('es').find((segment) => segment.slot === 'relation');
        expect(relation.values).toHaveLength(6);
        expect(relation.values[0]).toBe('tu mamá');
        expect(relation.values).toContain('tu compañero');
    });
});

describe('locale coverage', () => {
    it('carries a template and six relationships in every supported language', () => {
        expect(HERO_HEADLINE_LANGS).toEqual(['en', 'es', 'pt', 'fr', 'hi', 'bn']);
        for (const lang of HERO_HEADLINE_LANGS) {
            expect(heroHeadlineTemplate(lang), lang).toBeTruthy();
            expect(heroRelations(lang), lang).toHaveLength(6);
        }
    });

    it('writes the Hindi and Bengali headlines in their own script', () => {
        // The headline is marketing copy, so it must be genuinely translated —
        // an English sentence left in the hi/bn slot would still "work".
        expect(heroHeadlineText('hi')).toMatch(DEVANAGARI);
        expect(heroHeadlineText('hi')).not.toContain('Practice English');
        expect(heroHeadlineText('bn')).toMatch(BENGALI);
        expect(heroHeadlineText('bn')).not.toContain('Practice English');
        for (const relation of HERO_RELATIONS.hi) expect(relation).toMatch(DEVANAGARI);
        for (const relation of HERO_RELATIONS.bn) expect(relation).toMatch(BENGALI);
    });

    it('translates all six relationships in every language', () => {
        const english = HERO_RELATIONS.en;
        for (const lang of HERO_HEADLINE_LANGS.filter((code) => code !== 'en')) {
            for (const relation of HERO_RELATIONS[lang]) {
                expect(english, `${lang}/${relation}`).not.toContain(relation);
            }
        }
    });
});

describe('CEFR band pairing', () => {
    it('rotates the official bands, weakest first', () => {
        expect(heroFriendLevels()).toEqual(['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
        expect(heroFriendLevels()).toEqual([...HERO_CEFR_LEVELS]);
    });

    it('never puts both people at the same band and keeps them apart', () => {
        const friend = heroFriendLevels();
        const yours = heroYourLevels();
        expect(yours).toHaveLength(friend.length);
        friend.forEach((level, i) => {
            expect(yours[i], `tick ${i}`).not.toBe(level);
            const distance = Math.abs(HERO_CEFR_LEVELS.indexOf(yours[i]) - HERO_CEFR_LEVELS.indexOf(level));
            expect(Math.min(distance, HERO_CEFR_LEVELS.length - distance), `tick ${i}`)
                .toBeGreaterThanOrEqual(2);
        });
    });

    it('shifts by HERO_LEVEL_OFFSET and uses every band once', () => {
        expect(HERO_LEVEL_OFFSET).toBe(3);
        expect(new Set(heroYourLevels()).size).toBe(HERO_CEFR_LEVELS.length);
        expect(heroYourLevels()[0]).toBe(HERO_CEFR_LEVELS[HERO_LEVEL_OFFSET]);
    });

    it('returns copies so a caller cannot mutate the shared list', () => {
        heroFriendLevels().push('Z9');
        heroRelations('en').push('your dog');
        expect(heroFriendLevels()).toHaveLength(7);
        expect(heroRelations('en')).toHaveLength(6);
    });
});

describe('heroSlotIndex', () => {
    it('wraps in both directions and survives junk input', () => {
        expect(heroSlotIndex(0, 6)).toBe(0);
        expect(heroSlotIndex(6, 6)).toBe(0);
        expect(heroSlotIndex(7, 6)).toBe(1);
        expect(heroSlotIndex(-1, 6)).toBe(5);
        expect(heroSlotIndex(-7, 6)).toBe(5);
        expect(heroSlotIndex(2.9, 6)).toBe(2);
        expect(heroSlotIndex(NaN, 6)).toBe(0);
        expect(heroSlotIndex(3, 0)).toBe(0);
        expect(heroSlotIndex(3, NaN)).toBe(0);
    });

    it('resolves every slot for a tick without indexing off the end', () => {
        for (const tick of [0, 5, 6, 41, 42, 1000, -3]) {
            const resolved = resolveHeroHeadline('es', tick);
            for (const segment of resolved.filter((s) => s.kind === 'slot')) {
                expect(segment.values[segment.activeIndex], `tick ${tick}`).toBeTruthy();
            }
            expect(heroHeadlineText('es', tick)).not.toContain('undefined');
        }
    });
});

describe('rotation cadence', () => {
    it('repeats the same relationship + band pair only after 42 ticks', () => {
        // lcm(6 relationships, 7 bands) — six and seven are coprime.
        const seen = new Set();
        for (let tick = 0; tick < 42; tick += 1) {
            seen.add(`${heroHeadlineText('en', tick)}`);
        }
        expect(seen.size).toBe(42);
        expect(heroHeadlineText('en', 42)).toBe(heroHeadlineText('en', 0));
    });

    it('is deterministic: the same tick always renders the same sentence', () => {
        for (const tick of [0, 1, 3, 7, 29]) {
            expect(heroHeadlineText('pt', tick)).toBe(heroHeadlineText('pt', tick));
        }
    });

    it('advances each slot on its own list length', () => {
        const relation = heroHeadlineSegments('en').find((s) => s.slot === 'relation');
        const friend = heroHeadlineSegments('en').find((s) => s.slot === 'friendLevel');
        const yours = heroHeadlineSegments('en').find((s) => s.slot === 'yourLevel');
        expect(heroSlotValues('relation', 'en')).toEqual(relation.values);
        expect(heroSlotValues('friendLevel', 'en')).toEqual(friend.values);
        expect(heroSlotValues('yourLevel', 'en')).toEqual(yours.values);
        expect(heroSlotValues('nope', 'en')).toEqual([]);
    });
});

describe('readPrefersReducedMotion', () => {
    it('is false when the browser has no matchMedia (jsdom, old browsers)', () => {
        expect(readPrefersReducedMotion(undefined)).toBe(false);
        expect(readPrefersReducedMotion(null)).toBe(false);
        expect(readPrefersReducedMotion('not a function')).toBe(false);
    });

    it('asks the reduced-motion query and returns its verdict', () => {
        const matchMedia = vi.fn(() => ({ matches: true }));
        expect(readPrefersReducedMotion(matchMedia)).toBe(true);
        expect(matchMedia).toHaveBeenCalledWith(HERO_REDUCED_MOTION_QUERY);
        expect(HERO_REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
        expect(readPrefersReducedMotion(() => ({ matches: false }))).toBe(false);
    });

    it('reads as "motion is welcome" when matchMedia throws, and logs it', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(readPrefersReducedMotion(() => { throw new Error('boom'); })).toBe(false);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });
});
