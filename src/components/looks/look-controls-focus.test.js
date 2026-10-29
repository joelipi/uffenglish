// Guards for a user-visible bug that no behavioural unit test can catch:
// iOS Safari keeps its native focus ring (and its default button chrome) on a
// <button> after a TAP, so a look option the learner had tapped and then
// abandoned kept a white outline that read as "still selected" (stories/092).
//
// Two things have to stay true:
//   1. every button in the picker opts out of the UA ring (class `look-tap`),
//   2. `app.css` actually suppresses `:focus` (while keeping a keyboard cue).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const COMPONENT = resolve(process.cwd(), 'src/components/looks/LookControls.jsx');
const CSS = resolve(process.cwd(), 'src/assets/css/app.css');

function read(path) {
    return readFileSync(path, 'utf8');
}

/** The `.look-tap` rule block, up to the next top-level rule. */
function lookTapBaseBlock(css) {
    const start = css.indexOf('.look-tap {');
    expect(start).toBeGreaterThan(-1);
    const end = css.indexOf('}', start);
    return css.slice(start, end + 1);
}

/** The `.look-tap:focus { … }` rule block. */
function lookTapFocusBlock(css) {
    const start = css.indexOf('.look-tap:focus {');
    expect(start).toBeGreaterThan(-1);
    const end = css.indexOf('}', start);
    return css.slice(start, end + 1);
}

describe('look controls do not keep the native focus ring', () => {
    it('every button in the picker carries the look-tap class', () => {
        // Drop whole-line comments first: the file's own prose mentions
        // `<button>` and would otherwise be counted as a real one.
        const source = read(COMPONENT)
            .split('\n')
            .filter((line) => !line.trim().startsWith('//'))
            .join('\n');
        const buttons = source.match(/<button\b/g) || [];
        const tagged = source.match(/className="look-tap"/g) || [];
        expect(buttons.length).toBeGreaterThan(0);
        expect(tagged.length).toBe(buttons.length);
    });

    it('app.css removes the UA button chrome, the tap highlight, and the focus ring', () => {
        const css = read(CSS);
        const base = lookTapBaseBlock(css);
        expect(base).toMatch(/-webkit-appearance:\s*none/);
        expect(base).toMatch(/^\s*appearance:\s*none/m);
        expect(base).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
        const focus = lookTapFocusBlock(css);
        expect(focus).toMatch(/outline:\s*none/);
    });

    it('keeps a keyboard focus cue', () => {
        const css = read(CSS);
        expect(css).toMatch(/\.look-tap:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    });

    it('resets the UA button chrome inline on every button style, not only in a stylesheet', () => {
        // iOS draws a white rounded bezel on a bare <button>. The class covers
        // it, but the inline styles are what a stale/missing stylesheet cannot
        // drop (that is how the bezel survived a whole round of fixes). One
        // shared constant, spread into every button block so none can be
        // forgotten — including a block added later.
        const source = read(COMPONENT);
        const defStart = source.indexOf('const UA_RESET = {');
        expect(defStart).toBeGreaterThan(-1);
        const def = source.slice(defStart, source.indexOf('};', defStart));
        expect(def).toContain("WebkitAppearance: 'none'");
        expect(def).toContain("appearance: 'none'");
        expect(def).toContain("WebkitTapHighlightColor: 'transparent'");

        for (const block of ['trayChip', 'railBtn', 'resetButton']) {
            const start = source.indexOf(`    ${block}: {`);
            expect(start).toBeGreaterThan(-1);
            const end = source.indexOf('\n    },', start);
            expect(source.slice(start, end)).toContain('...UA_RESET');
        }
    });

    it('releases focus only for pointer activation, so tab navigation survives', () => {
        const source = read(COMPONENT);
        const start = source.indexOf('function releaseFocusAfterPointerTap(');
        expect(start).toBeGreaterThan(-1);
        // Slice to the next top-level declaration so a later function cannot
        // satisfy the assertion by accident.
        const end = source.indexOf('\nfunction ', start + 10);
        const body = source.slice(start, end === -1 ? undefined : end);
        expect(body).toContain('event?.detail > 0');
        expect(body).toContain('event.currentTarget.blur()');
    });
});

describe('every picker row is a tray, and no horizontal strip survives', () => {
    // All six rows (Filter/Lens/Screen/Top/Face/Bottom) share the vertical
    // grid tray now: a horizontal strip can only show its last items by
    // scrolling to a far snap point, which on iOS reads as stuck partway.
    function traySource() {
        return read(COMPONENT)
            .split('\n')
            .filter((line) => !line.trim().startsWith('//'))
            .join('\n');
    }

    /** A `name: { … }` style block, bounded at its own closing brace. */
    function styleBlock(source, name) {
        const start = source.indexOf(`    ${name}: {`);
        expect(start).toBeGreaterThan(-1);
        const end = source.indexOf('\n    },', start);
        expect(end).toBeGreaterThan(start);
        return source.slice(start, end);
    }

    it('every picker renders the shared tray', () => {
        const source = traySource();
        expect(source.match(/style=\{styles\.trayStrip\}/g)?.length).toBe(2);
        expect(source.match(/styles\.trayChip,/g)?.length).toBeGreaterThanOrEqual(3);
        for (const prefix of ['look-filter', 'look-lens', 'look-screen']) {
            expect(source).toContain(`testidPrefix="${prefix}"`);
        }
        for (const slot of ['upper', 'face', 'lower', 'emoji']) {
            expect(source).toContain('data-testid={`look-slot-row-${slot}`}');
        }
    });

    it('no horizontal strip, squeezed chip, or snap survives anywhere', () => {
        const source = traySource();
        expect(source).not.toContain('    foldoutStrip: {');
        expect(source).not.toContain('    chip: {');
        expect(source).not.toContain('    chipLabel');
        expect(source).not.toMatch(/scrollSnap/);
        expect(source).not.toMatch(/100vw/);
    });

    it('the rail spans the frame but only buttons and trays capture touches', () => {
        const source = traySource();
        const rail = styleBlock(source, 'rail');
        expect(rail).toMatch(/left:\s*12/);
        expect(rail).toMatch(/right:\s*12/);
        expect(rail).toMatch(/pointerEvents:\s*'none'/);
        for (const name of ['railBtn', 'foldoutColumn', 'trayStrip']) {
            expect(styleBlock(source, name)).toMatch(/pointerEvents:\s*'auto'/);
        }
    });

    it('every thumbnail image is non-draggable and pointer-transparent', () => {
        const source = traySource();
        const imgs = source.match(/<img\b/g) || [];
        expect(imgs.length).toBeGreaterThan(0);
        expect((source.match(/draggable=\{false\}/g) || []).length).toBe(imgs.length);
        for (const name of ['thumb', 'railThumb']) {
            const block = styleBlock(source, name);
            expect(block).toMatch(/pointerEvents:\s*'none'/);
            expect(block).toMatch(/userSelect:\s*'none'/);
        }
    });
});

describe('prop rows are a grid tray pinned to the rail top', () => {
    // A horizontal strip can only show its last items by scrolling to a far
    // snap point, which on iOS reads as "stuck partway" — and it gets worse
    // with every overlay added. The prop rows (Face/Top/Bottom) are a
    // three-column grid in a vertical tray instead, pinned to the top of the
    // rail so the menu (and the Size slider under it) never reaches the mic
    // band; the swatch rows keep their horizontal strip.
    function traySource() {
        return read(COMPONENT)
            .split('\n')
            .filter((line) => !line.trim().startsWith('//'))
            .join('\n');
    }

    function trayBlock(name) {
        const source = traySource();
        const start = source.indexOf(`    ${name}: {`);
        expect(start).toBeGreaterThan(-1);
        const end = source.indexOf('\n    },', start);
        expect(end).toBeGreaterThan(start);
        return source.slice(start, end);
    }

    it('the tray is a three-column grid with a fixed pixel cap', () => {
        const block = trayBlock('trayStrip');
        expect(block).toMatch(/display:\s*'grid'/);
        expect(block).toMatch(/gridTemplateColumns:\s*'repeat\(3, 1fr\)'/);
        expect(block).toMatch(/overflowY:\s*'auto'/);
        expect(block).toMatch(/maxHeight:\s*300/);
        // Fills its container (the anchored column or the rail row) instead of
        // shrink-wrapping to content: a collapsed tray hides labels and
        // shrinks touch targets.
        expect(block).toMatch(/width:\s*'100%'/);
        // Capped so the tray stays compact on wide frames instead of
        // stretching the full anchored width.
        expect(block).toMatch(/maxWidth:\s*420/);
        expect(block).toMatch(/touchAction:\s*'pan-y'/);
        expect(block).toMatch(/WebkitOverflowScrolling:\s*'touch'/);
        expect(block).toMatch(/transform:\s*'translateZ\(0\)'/);
        // No snap at all: a snap point near the end is what used to stop the
        // strip partway with the last item half-showing.
        expect(block).not.toMatch(/scrollSnap/);
    });

    it('tray cells stack the label under the thumbnail', () => {
        const block = trayBlock('trayChip');
        expect(block).toMatch(/flexDirection:\s*'column'/);
        expect(block).toMatch(/alignItems:\s*'center'/);
        const label = trayBlock('trayChipLabel');
        expect(label).toMatch(/textAlign:\s*'center'/);
    });

    it('the tray is pinned to the rail top, clear of the mic band', () => {
        const block = trayBlock('foldoutColumn');
        expect(block).toMatch(/position:\s*'absolute'/);
        expect(block).toMatch(/top:\s*0/);
        expect(block).toMatch(/left:\s*56/);
        // The right anchor is the actual fix for the sailing tray: without it
        // the tray sizes from viewport units and runs past the screen edge on
        // frames narrower than the viewport.
        expect(block).toMatch(/right:\s*0/);
    });

    it('the rail starts just below the header blur', () => {
        const block = trayBlock('rail');
        // The blurred band is the top ~18.5% of the frame.
        expect(block).toMatch(/top:\s*'19%'/);
    });

    it('OverlayFoldout and ChoiceStrip both render the tray', () => {
        const source = traySource();
        expect(source).toMatch(/style=\{styles\.trayStrip\}/);
        expect(source.match(/style=\{\{\s*\.\.\.styles\.trayChip,/g)?.length).toBeGreaterThanOrEqual(3);
        expect(source).toMatch(/testidPrefix="look-filter"/);
    });
});

describe('look control icons and categories', () => {
    it('the Top slot shows a hat, not a magic wand', () => {
        const source = read(COMPONENT);
        const start = source.indexOf("slot: 'upper'");
        expect(start).toBeGreaterThan(-1);
        const line = source.slice(start, source.indexOf('},', start));
        expect(line).toContain('TophatIcon');
        expect(line).not.toContain('bi-magic');
    });

    it('the emoji drawer loads the full generated collection lazily and selects a Twemoji slug', () => {
        const source = read(COMPONENT);
        expect(source).toContain("import('../../generated/twemoji-emojis.js')");
        expect(source).toContain('TWEMOJI_EMOJIS');
        expect(source).toContain('loading="lazy"');
        expect(source).toContain("setLookSlot('emoji', slug)");
    });

    it('the emoji grid fits its six columns and only scrolls vertically', () => {
        const source = read(COMPONENT);
        const start = source.indexOf('emojiGrid: {');
        expect(start).toBeGreaterThan(-1);
        const block = source.slice(start, source.indexOf('emojiCell: {', start));
        expect(block).toContain("gridTemplateColumns: 'repeat(6, minmax(0, 1fr))'");
        expect(block).toContain("overflowX: 'hidden'");
        expect(block).toContain("overflowY: 'auto'");
    });

    it('the emoji cells never rely on aspect-ratio or percentage image heights', () => {
        // Safari ignores aspect-ratio on <button>: every row collapsed to zero
        // height and the sheet piled at one spot. The image height must come
        // from its own ratio (width 100% + height auto), never a percentage.
        const source = read(COMPONENT);
        const cellStart = source.indexOf('emojiCell: {');
        expect(cellStart).toBeGreaterThan(-1);
        const cellBlock = source.slice(cellStart, source.indexOf('emojiCellSelected: {', cellStart));
        expect(cellBlock).not.toContain('aspectRatio');
        const thumbStart = source.indexOf('emojiThumb: {');
        expect(thumbStart).toBeGreaterThan(-1);
        const thumbBlock = source.slice(thumbStart, source.indexOf('emojiMore: {', thumbStart));
        expect(thumbBlock).toContain("height: 'auto'");
        expect(thumbBlock).not.toContain("height: '100%'");
    });

    it('the rail carries the three categories plus the four slots', () => {
        const source = read(COMPONENT);
        for (const id of ['look-drawer-toggle-filter', 'look-drawer-toggle-lens', 'look-drawer-toggle-screen']) {
            expect(source).toContain(id);
        }
        for (const slot of ['upper', 'face', 'lower', 'emoji']) {
            expect(source).toContain('data-testid={`look-drawer-toggle-${slot}`}');
        }
    });
});
