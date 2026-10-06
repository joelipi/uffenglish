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
