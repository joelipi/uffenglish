import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(path.join(__dirname, ...segments), 'utf8');

const APP_CSS = read('..', 'assets', 'css', 'app.css');
const LESSON_CONTAINER = read('LessonContainer.jsx');

// Slice a single rule block by selector. A whole-file toContain stays green
// even when the specific rule is deleted, so every assertion below is scoped
// to the block it protects.
const blockFor = (source, selector) => {
    const start = source.indexOf(`${selector} {`);
    if (start === -1) return '';
    const end = source.indexOf('}', start);
    return source.slice(start, end + 1);
};

describe('top overlay blur backdrop', () => {
    it('LessonContainer renders the backdrop layer inside the top overlay, above the blur and below the content', () => {
        const overlayStart = LESSON_CONTAINER.indexOf('className="top-overlay ');
        const overlayEnd = LESSON_CONTAINER.indexOf('{/* Controls */}', overlayStart);
        expect(overlayStart).toBeGreaterThan(-1);
        expect(overlayEnd).toBeGreaterThan(overlayStart);
        const overlay = LESSON_CONTAINER.slice(overlayStart, overlayEnd);
        const backdropIdx = overlay.indexOf('className="top-overlay-backdrop"');
        const contentIdx = overlay.indexOf('className="top-overlay-content');
        expect(backdropIdx).toBeGreaterThan(-1);
        expect(contentIdx).toBeGreaterThan(backdropIdx);
        // The blur layer must be decorative only (no pointer/focus target).
        expect(overlay).toContain('<div className="top-overlay-backdrop" aria-hidden="true"></div>');
    });

    it('the backdrop strongly blurs the video behind it (prefixed + standard)', () => {
        const block = blockFor(APP_CSS, '.top-overlay-backdrop');
        expect(block).not.toBe('');
        // Anchor each to a line start: an unanchored /backdrop-filter:/ would
        // also match the -webkit- line, so the unprefixed guard could never
        // fail when only the -webkit- declaration is deleted.
        expect(block).toMatch(/^\s*backdrop-filter:\s*blur\(1[0-9]px\)/m);
        expect(block).toMatch(/^\s*-webkit-backdrop-filter:\s*blur\(1[0-9]px\)/m);
    });

    it('the backdrop fades the blur out with a mask so it cannot cut a hard edge over the video', () => {
        const block = blockFor(APP_CSS, '.top-overlay-backdrop');
        expect(block).toMatch(/^\s*mask-image:\s*linear-gradient\(/m);
        expect(block).toMatch(/^\s*-webkit-mask-image:\s*linear-gradient\(/m);
    });

    it('the backdrop is non-interactive and the content stays above it', () => {
        const backdrop = blockFor(APP_CSS, '.top-overlay-backdrop');
        expect(backdrop).toMatch(/^\s*pointer-events:\s*none/m);
        const content = blockFor(APP_CSS, '.top-overlay-content');
        expect(content).not.toBe('');
        expect(content).toMatch(/^\s*z-index:\s*1/m);
    });
});
