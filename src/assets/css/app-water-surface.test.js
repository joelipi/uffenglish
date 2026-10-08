// Guard: the reusable water visual must keep its shimmer but paint it behind
// its content, so the sheen only shows where the blue water colour is actually
// visible. `.water-surface::before` is absolutely positioned with `z-index: -1`
// inside an `isolation: isolate` stacking context; without those two
// declarations it paints over static page content again (the bug), and without
// the animation/gradient the glistening effect is lost. See
// stories/050-water-glisten-blue-only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_CSS = readFileSync(path.join(HERE, 'app.css'), 'utf8');

// Slice a single CSS rule block by selector, ending at its first `}`. Scoping to
// the block (rather than the whole file) is required so this guard can fail:
// a file-wide `toContain` stays green even when the rule is deleted.
const blockFor = (selector) => {
    const start = APP_CSS.indexOf(`${selector} {`);
    if (start === -1) return '';
    const end = APP_CSS.indexOf('}', start);
    return APP_CSS.slice(start, end + 1);
};

const WATER = blockFor('.water-surface');
const WATER_BEFORE = blockFor('.water-surface::before');

describe('water shimmer is scoped to visible water (.water-surface)', () => {
    it('looks up both rule blocks (guards against a renamed selector)', () => {
        expect(WATER).not.toBe('');
        expect(WATER_BEFORE).not.toBe('');
    });

    it('establishes a stacking context so the shimmer can sit behind content', () => {
        expect(WATER).toMatch(/isolation:\s*isolate/);
        expect(WATER).toMatch(/position:\s*relative/);
    });

    it('keeps the blue water gradient background', () => {
        expect(WATER).toMatch(/background:\s*linear-gradient\(/);
        expect(WATER).toMatch(/rgba\(58,\s*143,\s*213/);
        expect(WATER).toMatch(/rgba\(0,\s*192,\s*216/);
    });

    it('paints the shimmer behind content, not over it', () => {
        expect(WATER_BEFORE).toMatch(/z-index:\s*-1/);
    });

    it('keeps the glistening effect (inset, sheen, animation, no pointer capture)', () => {
        expect(WATER_BEFORE).toMatch(/content:\s*''/);
        expect(WATER_BEFORE).toMatch(/position:\s*absolute/);
        expect(WATER_BEFORE).toMatch(/inset:\s*0/);
        expect(WATER_BEFORE).toMatch(/background:\s*linear-gradient\(/);
        expect(WATER_BEFORE).toMatch(/background-size:\s*300%\s*100%/);
        expect(WATER_BEFORE).toMatch(/animation:\s*waterShimmer/);
        expect(WATER_BEFORE).toMatch(/pointer-events:\s*none/);
    });
});

describe('water-surface opacity hides the video\u2019s burnt-on captions', () => {
    // The lesson video overlays (`.ivp-overlay.water-surface`) share this
    // gradient. On-screen clips now carry burnt-on captions, so the veil must be
    // heavy enough that those glyphs cannot show through and collide with the
    // overlaid headline/labels/buttons. Parse the actual gradient stops so this
    // guard fails if the alphas are lightened again (a whole-file `toContain`
    // would not).
    const stops = [...WATER.matchAll(
        /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)\s*([\d.]+)%/g
    )].map((m) => ({ alpha: Number(m[4]), pos: Number(m[5]) }));

    it('parses the stops of the water gradient', () => {
        expect(stops.length).toBeGreaterThanOrEqual(4);
    });

    it('never drops below a heavy veil (alpha >= 0.7 anywhere)', () => {
        expect(stops.length).toBeGreaterThan(0);
        expect(Math.min(...stops.map((s) => s.alpha))).toBeGreaterThanOrEqual(0.7);
    });

    it('reaches full opacity by about two-thirds down and stays opaque', () => {
        const firstOpaque = stops.find((s) => s.alpha === 1);
        expect(firstOpaque).toBeDefined();
        // Pin the intent (opaque by ~two-thirds), not a magic threshold: if the
        // first fully-opaque stop drifts lower, the captions in that band show.
        expect(firstOpaque.pos).toBeLessThanOrEqual(70);
        const last = stops[stops.length - 1];
        expect(last.pos).toBe(100);
        expect(last.alpha).toBe(1);
    });
});
