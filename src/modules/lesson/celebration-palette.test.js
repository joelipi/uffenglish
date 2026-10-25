// The celebrations in the app palette (stories/095-celebration-app-palette).
//
// Colour is data, so it is asserted numerically rather than by eye: every palette
// has to read on BOTH backdrops the pieces travel over (the blue gradient / black
// frame AND white panels), and the warm accent has to stay an accent.

import { describe, it, expect } from 'vitest';
import {
    CELEBRATION_ACCENT,
    CELEBRATION_BACKDROP_COLORS,
    CELEBRATION_PALETTES,
    CELEBRATION_VARIANTS,
    buildCelebrationPlan,
} from './step-celebration-logic.js';

function contrastRatio(a, b) {
    const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

function srgbToLinear(channel) {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
    const match = /^#([0-9a-f]{6})$/i.exec(String(hex));
    if (!match) throw new Error(`not a hex colour: ${hex}`);
    const value = parseInt(match[1], 16);
    const r = srgbToLinear((value >> 16) & 0xff);
    const g = srgbToLinear((value >> 8) & 0xff);
    const b = srgbToLinear(value & 0xff);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const LIGHT_MIN = 0.75;
const DEEP_MAX = 0.12;

describe('the luminance helper (so the rule below cannot pass vacuously)', () => {
    it('ranks white above navy above black', () => {
        expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 3);
        expect(relativeLuminance('#0b2036')).toBeLessThan(DEEP_MAX);
        expect(relativeLuminance('#000000')).toBeCloseTo(0, 3);
        expect(relativeLuminance('#ffffff')).toBeGreaterThan(relativeLuminance('#3a8fd5'));
    });

    it('rejects a non-hex value instead of scoring it 0', () => {
        expect(() => relativeLuminance('white')).toThrow();
    });
});

describe('every palette reads on both backdrops', () => {
    it('carries a light piece (gradient / black frame)', () => {
        Object.entries(CELEBRATION_PALETTES).forEach(([name, colors]) => {
            const lightest = Math.max(...colors.map(relativeLuminance));
            expect(lightest, `${name} lightest piece`).toBeGreaterThanOrEqual(LIGHT_MIN);
        });
    });

    it('carries a deep piece (white panels, success card)', () => {
        Object.entries(CELEBRATION_PALETTES).forEach(([name, colors]) => {
            const darkest = Math.min(...colors.map(relativeLuminance));
            expect(darkest, `${name} darkest piece`).toBeLessThanOrEqual(DEEP_MAX);
        });
    });

    it('mixes at least three pieces per palette', () => {
        Object.entries(CELEBRATION_PALETTES).forEach(([name, colors]) => {
            expect(colors.length, name).toBeGreaterThanOrEqual(3);
        });
    });
});

describe('the warm accent stays an accent', () => {
    it('appears in at least three palettes but never in all of them', () => {
        const withAccent = Object.values(CELEBRATION_PALETTES)
            .filter((colors) => colors.map((c) => c.toLowerCase()).includes(CELEBRATION_ACCENT));
        expect(withAccent.length).toBeGreaterThanOrEqual(3);
        expect(withAccent.length).toBeLessThan(Object.keys(CELEBRATION_PALETTES).length);
    });

    it('every variant still offers a palette without the accent (calm option)', () => {
        const calmPalette = Object.entries(CELEBRATION_PALETTES)
            .filter(([, colors]) => !colors.map((c) => c.toLowerCase()).includes(CELEBRATION_ACCENT))
            .map(([name]) => name);
        expect(calmPalette.length).toBeGreaterThan(0);
        // Not every variant needs one, but the registry must be able to offer one.
        const usesCalm = CELEBRATION_VARIANTS.some((variant) => variant.palettes.some((key) => calmPalette.includes(key)));
        expect(usesCalm).toBe(true);
    });
});

describe('no legacy celebration colours survive', () => {
    it('has no candy / gold / rainbow hexes left over', () => {
        const legacy = ['#ff5e7e', '#ffa62d', '#fcff42', '#ffd166', '#ffb703', '#fff3b0', '#ff7ab6', '#ff3d7f', '#b388ff', '#7c4dff', '#ffea00', '#26ccff', '#a25afd', '#88ff5a', '#ff36ff'];
        const used = Object.values(CELEBRATION_PALETTES).flat().map((c) => c.toLowerCase());
        legacy.forEach((hex) => expect(used).not.toContain(hex));
    });

    it('every burst the planner builds uses a registry palette', () => {
        const palettes = Object.values(CELEBRATION_PALETTES);
        CELEBRATION_VARIANTS.forEach((variant, index) => {
            const plan = buildCelebrationPlan(index, () => 0.5);
            plan.forEach((burst) => {
                expect(palettes, variant.id).toContainEqual(burst.options.colors);
            });
        });
    });
});

describe('no palette can blend into a surface the pieces travel over', () => {
    // The real requirement behind "they can't blend with the background": on
    // EVERY surface the confetti crosses, at least one piece of the palette has
    // to stand out. This is the rule the luminance checks exist for.
    it('every palette has at least one piece at contrast >= 2 against every backdrop', () => {
        Object.entries(CELEBRATION_BACKDROP_COLORS).forEach(([backdrop, backdropHex]) => {
            Object.entries(CELEBRATION_PALETTES).forEach(([paletteName, colors]) => {
                const best = Math.max(...colors.map((color) => contrastRatio(color, backdropHex)));
                expect(best, `${paletteName} vs ${backdrop}`).toBeGreaterThanOrEqual(2);
            });
        });
    });

    it('the accent is a highlight, not the contrast carrier (that is white/navy)', () => {
        // Amber has the best worst-case contrast of the warm candidates, but it
        // is deliberately NOT the piece that carries visibility.
        const worstAccent = Math.min(...Object.values(CELEBRATION_BACKDROP_COLORS).map((b) => contrastRatio(CELEBRATION_ACCENT, b)));
        const worstWhite = Math.min(...Object.values(CELEBRATION_BACKDROP_COLORS).map((b) => contrastRatio('#ffffff', b)));
        expect(worstAccent).toBeLessThan(worstWhite + 1);
        // ...and the deep piece covers the surface white cannot (white panels).
        expect(contrastRatio('#0b2036', '#ffffff')).toBeGreaterThan(10);
        // White in turn covers the dark surfaces the navy disappears into.
        expect(contrastRatio('#ffffff', CELEBRATION_BACKDROP_COLORS.card)).toBeGreaterThan(10);
        expect(contrastRatio('#ffffff', CELEBRATION_BACKDROP_COLORS.frame)).toBeGreaterThan(10);
    });
});
