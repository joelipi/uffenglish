import { describe, it, expect } from 'vitest';
import {
    BODY_FONT_FAMILY,
    BODY_FONT_WEIGHTS,
    HEADING_ALTERNATES,
    HEADING_FONT_FAMILY,
    HEADING_FONT_WEIGHT_BY_LEVEL,
    HEADING_FONT_WEIGHTS,
    HEADING_ITALIC_WEIGHTS,
    HEADING_LEVELS,
    LANG_FONT_WEIGHT,
    LANG_HEADING_FAMILIES,
    LANG_HEADING_FONTS,
    UNIVERSAL_FALLBACK_FONTS,
    fontStack,
    googleFontsUrl,
    headLinkTags,
    langHeadingFontStack,
    quoteFamily,
    requestedFamilies,
    requestedFontSpecs,
} from './brand-fonts.js';

describe('brand typography kit', () => {
    describe('core Latin faces', () => {
        it('body is Inter at 400/500/600', () => {
            expect(BODY_FONT_FAMILY).toBe('Inter');
            expect(BODY_FONT_WEIGHTS).toEqual([400, 500, 600]);
        });

        it('headings are Titillium Web at 700/900', () => {
            expect(HEADING_FONT_FAMILY).toBe('Titillium Web');
            expect(HEADING_FONT_WEIGHTS).toEqual([700, 900]);
        });

        it('both heading weights are actually used by a level', () => {
            const used = HEADING_LEVELS.map((l) => HEADING_FONT_WEIGHT_BY_LEVEL[l]);
            expect([...new Set(used)].sort()).toEqual([...HEADING_FONT_WEIGHTS].sort());
        });

        it('every requested heading weight is a subset of the requested weights', () => {
            for (const level of HEADING_LEVELS) {
                expect(HEADING_FONT_WEIGHTS).toContain(HEADING_FONT_WEIGHT_BY_LEVEL[level]);
            }
        });

        it('names the approved heading swaps so a rebrand is a one-line change', () => {
            expect(HEADING_ALTERNATES).toEqual(['Tomorrow', 'Chakra Petch', 'Saira']);
        });

        it('requests no true italic face that Google Fonts does not serve for 900', () => {
            // Titillium Web ships italic at 200/300/400/600/700 only;
            // `family=Titillium+Web:ital,wght@1,900` is a hard HTTP 400.
            expect(HEADING_ITALIC_WEIGHTS).toEqual([700]);
            expect(HEADING_ITALIC_WEIGHTS).not.toContain(900);
            expect(googleFontsUrl()).not.toContain('1,900');
        });
    });

    describe('universal fallback stack', () => {
        it('orders system-ui before the OS-native faces and sans-serif last', () => {
            expect(UNIVERSAL_FALLBACK_FONTS[0]).toBe('system-ui');
            const sans = UNIVERSAL_FALLBACK_FONTS.indexOf('sans-serif');
            expect(sans).toBe(UNIVERSAL_FALLBACK_FONTS.length - 1);
            for (const native of ['-apple-system', 'BlinkMacSystemFont']) {
                expect(UNIVERSAL_FALLBACK_FONTS.indexOf(native)).toBeGreaterThan(0);
                expect(UNIVERSAL_FALLBACK_FONTS.indexOf(native)).toBeLessThan(sans);
            }
        });

        it('includes Noto Sans for full-Unicode coverage', () => {
            expect(UNIVERSAL_FALLBACK_FONTS).toContain('Noto Sans');
        });

        it('appends the whole tail to every stack it builds', () => {
            for (const family of [BODY_FONT_FAMILY, HEADING_FONT_FAMILY, ...LANG_HEADING_FAMILIES]) {
                const stack = fontStack(family);
                for (const fallback of UNIVERSAL_FALLBACK_FONTS) {
                    expect(stack).toContain(quoteFamily(fallback));
                }
            }
        });

        it('never ends a stack without a generic family', () => {
            for (const family of [BODY_FONT_FAMILY, HEADING_FONT_FAMILY, ...LANG_HEADING_FAMILIES]) {
                expect(fontStack(family).endsWith('sans-serif')).toBe(true);
            }
        });

        it('quotes only families that need it', () => {
            expect(quoteFamily('Inter')).toBe('Inter');
            expect(quoteFamily('Titillium Web')).toBe("'Titillium Web'");
            expect(quoteFamily('sans-serif')).toBe('sans-serif');
            expect(quoteFamily('Noto Sans')).toBe("'Noto Sans'");
        });

        it('puts the family first in the stack', () => {
            expect(fontStack('Inter').startsWith('Inter, ')).toBe(true);
            expect(fontStack('Titillium Web').startsWith("'Titillium Web', ")).toBe(true);
        });
    });

    describe(':lang() heading overrides', () => {
        it.each([
            ['ja', 'Zen Kaku Gothic New'],
            ['zh', 'Noto Sans SC'],
            ['zh-Hant', 'Noto Sans TC'],
            ['hi', 'Khand'],
            ['bn', 'Hind Siliguri'],
        ])('%s maps to %s', (lang, family) => {
            expect(LANG_HEADING_FONTS[lang]).toBe(family);
            expect(langHeadingFontStack(lang).startsWith(quoteFamily(family))).toBe(true);
        });

        it('routes traditional Chinese subtags to the traditional face', () => {
            for (const subtag of ['zh-Hant', 'zh-HK', 'zh-TW']) {
                expect(LANG_HEADING_FONTS[subtag]).toBe('Noto Sans TC');
            }
        });

        it('falls back to the Latin display face for an unlisted language', () => {
            expect(langHeadingFontStack('ko')).toBe(fontStack(HEADING_FONT_FAMILY));
        });

        it('deduplicates families so a face is requested once', () => {
            // zh-Hant/zh-HK/zh-TW deliberately share Noto Sans TC, so the raw
            // value list has duplicates and only the family list is unique.
            const values = Object.values(LANG_HEADING_FONTS);
            expect(LANG_HEADING_FAMILIES).toEqual([...new Set(values)]);
            expect(new Set(LANG_HEADING_FAMILIES).size).toBe(LANG_HEADING_FAMILIES.length);
        });
    });

    describe('Google Fonts URL', () => {
        const url = googleFontsUrl();

        it('targets the css2 endpoint', () => {
            expect(url.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
        });

        it('uses display=swap so text is never invisible while loading', () => {
            expect(url).toContain('&display=swap');
            expect(url).not.toMatch(/display=(block|optional|fallback|auto)/);
        });

        it('requests exactly the body weights', () => {
            expect(url).toContain('family=Inter:wght@400;500;600');
        });

        it('requests exactly the heading weights and only real italic faces', () => {
            expect(url).toContain('family=Titillium+Web:ital,wght@0,700;0,900;1,700');
        });

        it('never requests a weight the kit does not declare', () => {
            const requested = [...url.matchAll(/wght@([^&]+)/g)].map((m) => m[1]);
            const declared = new Set([...BODY_FONT_WEIGHTS, ...HEADING_FONT_WEIGHTS, LANG_FONT_WEIGHT]);
            for (const axis of requested) {
                const weights = axis.split(';').map((pair) => pair.split(',').pop());
                for (const w of weights) expect(declared).toContain(Number(w));
            }
        });

        it('requests every family the :lang() rules reference', () => {
            for (const family of requestedFamilies()) {
                expect(url).toContain(`family=${family.replace(/ /g, '+')}:`);
            }
        });

        it('does not request a family twice', () => {
            const families = [...url.matchAll(/family=([^:&]+):/g)].map((m) => decodeURIComponent(m[1]));
            expect(families).toHaveLength(new Set(families).size);
        });

        it('lists families in a stable sorted order (cache-friendly)', () => {
            const families = [...url.matchAll(/family=([^:&]+):/g)].map((m) => decodeURIComponent(m[1]));
            expect(families).toEqual([...families].sort((a, b) => a.localeCompare(b)));
        });

        it('uses no weights for the lang families beyond the heading weight', () => {
            for (const spec of requestedFontSpecs()) {
                if (LANG_HEADING_FAMILIES.includes(spec.family)) {
                    expect(spec.weights).toEqual([LANG_FONT_WEIGHT]);
                    expect(spec.italicWeights).toEqual([]);
                }
            }
        });
    });

    describe('head link tags', () => {
        const tags = headLinkTags();

        it('preconnects both font origins, with crossorigin only on gstatic', () => {
            expect(tags[0]).toBe('<link rel="preconnect" href="https://fonts.googleapis.com">');
            expect(tags[1]).toBe('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
            expect(tags.filter((t) => t.includes('crossorigin'))).toHaveLength(1);
        });

        it('preconnects before the stylesheet', () => {
            expect(tags.indexOf(tags[0])).toBeLessThan(tags.indexOf(tags[2]));
            expect(tags.indexOf(tags[1])).toBeLessThan(tags.indexOf(tags[2]));
        });

        it('carries exactly one stylesheet link, pointing at the css2 URL', () => {
            const stylesheets = tags.filter((t) => t.includes('rel="stylesheet"'));
            expect(stylesheets).toHaveLength(1);
            expect(stylesheets[0]).toContain(googleFontsUrl());
        });

        it('does not put crossorigin on the stylesheet link', () => {
            // The css2 stylesheet is fetched as a plain stylesheet; only the
            // .woff2 files on gstatic are CORS requests.
            expect(tags[2]).not.toContain('crossorigin');
        });
    });
});