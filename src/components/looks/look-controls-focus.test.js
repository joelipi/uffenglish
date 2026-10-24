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
