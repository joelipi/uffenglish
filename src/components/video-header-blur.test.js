import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(path.join(__dirname, ...segments), 'utf8');

const APP_CSS = read('..', 'assets', 'css', 'app.css');
const LESSON_CONTAINER = read('LessonContainer.jsx');

// Slice a single rule block by selector. A whole-file toContain stays green
// even when the specific rule is deleted, so every assertion is scoped to the
// block it protects.
const blockFor = (source, selector) => {
    const start = source.indexOf(`${selector} {`);
    if (start === -1) return '';
    const end = source.indexOf('}', start);
    return source.slice(start, end + 1);
};

describe('video header blur layer', () => {
    // Source guards only: they prove the CSS/JSX is wired, not that the
    // compositor blurs the video. The real blur is verified in a browser.
    it('sizes the blur height to the single video-header variable times the frame height', () => {
        const block = blockFor(APP_CSS, '.video-header-blur');
        expect(block).not.toBe('');
        // Anchor to the line: an unanchored search would also match a stray
        // occurrence elsewhere and could never fail on this rule.
        expect(block).toMatch(/^\s*height:\s*calc\(var\(--video-header-ratio[^)]*\)\s*\*\s*100%\)/m);
    });

    it('strongly blurs with prefixed + standard backdrop-filter', () => {
        const block = blockFor(APP_CSS, '.video-header-blur');
        expect(block).toMatch(/^\s*backdrop-filter:\s*blur\(1[0-9]px\)/m);
        expect(block).toMatch(/^\s*-webkit-backdrop-filter:\s*blur\(1[0-9]px\)/m);
    });

    it('is non-interactive and sits below the top overlay but above the video', () => {
        const block = blockFor(APP_CSS, '.video-header-blur');
        expect(block).toMatch(/^\s*pointer-events:\s*none/m);
        expect(block).toMatch(/^\s*z-index:\s*34/m);
    });

    it('LessonContainer renders the blur layer from the pure logic module', () => {
        expect(LESSON_CONTAINER).toContain(
            "import { isVideoHeaderBlurVisible, videoHeaderBlurStyle } from '../modules/video/video-header-logic.js';"
        );
        expect(LESSON_CONTAINER).toContain('{isVideoHeaderBlurVisible(mediaState) && (');
        expect(LESSON_CONTAINER).toContain(
            'className="video-header-blur" aria-hidden="true" style={videoHeaderBlurStyle()}'
        );
    });
});
