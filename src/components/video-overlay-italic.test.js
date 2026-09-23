import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(path.join(__dirname, ...segments), 'utf8');

const SIMPLE_PLAYER = read('SimpleVideoPlayer.web.jsx');
const INTERACTIVE_PLAYER = read('InteractiveVideoPlayer.web.jsx');
const INCOMING_WIDGET = read('IncomingVideoWidget.jsx');
const APP_CSS = read('..', 'assets', 'css', 'app.css');

const blockFor = (source, selector) => {
    const start = source.indexOf(`${selector} {`);
    if (start === -1) return '';
    const end = source.indexOf('}', start);
    return source.slice(start, end + 1);
};

describe('video overlay text is upright (no synthetic italic)', () => {
    describe('DOM overlays no longer wrap the localized span in <i>', () => {
        it('SimpleVideoPlayer.web.jsx keeps lang and drops the <i> child', () => {
            expect(SIMPLE_PLAYER).toContain(
                '<span lang={overlayBilingual.lang}>{overlayBilingual.localized}</span>'
            );
            expect(SIMPLE_PLAYER).not.toContain(
                '<span lang={overlayBilingual.lang}><i>{overlayBilingual.localized}</i></span>'
            );
        });

        it('InteractiveVideoPlayer.web.jsx keeps lang and drops the <i> child', () => {
            expect(INTERACTIVE_PLAYER).toContain(
                '<span lang={overlayBilingual.lang}>{overlayBilingual.localized}</span>'
            );
            expect(INTERACTIVE_PLAYER).not.toContain(
                '<span lang={overlayBilingual.lang}><i>{overlayBilingual.localized}</i></span>'
            );
        });

        it('IncomingVideoWidget.jsx keeps lang and drops the <i> child', () => {
            expect(INCOMING_WIDGET).toContain(
                '<span lang={subtitle.lang}>{subtitle.localized}</span>'
            );
            expect(INCOMING_WIDGET).not.toContain(
                '<span lang={subtitle.lang}><i>{subtitle.localized}</i></span>'
            );
        });
    });

    describe('CSS keeps video overlay [lang] text upright', () => {
        it('the .intro-call-subtitle block has no italic', () => {
            const block = blockFor(APP_CSS, '.intro-call-subtitle');
            expect(block).not.toBe('');
            expect(block).not.toMatch(/font-style:\s*italic/);
        });

        it('an overlay-scoped override sets font-style: normal for both overlays', () => {
            expect(APP_CSS).toMatch(
                /\.ivp-overlay-text \[lang\],\s*\.intro-call-subtitle \[lang\] \{\s*font-style: normal !important;\s*\}/
            );
        });
    });

    describe('non-video UI and the global italic rule are unchanged', () => {
        it('the global [lang] italic rule is byte-for-byte unchanged', () => {
            expect(APP_CSS).toContain(
                '[lang]:not([lang="en"]):not([lang="EN"]) {\n    font-style: italic;\n}'
            );
        });

        it('non-video localized UI still uses the <i> pattern', () => {
            const widgets = [
                read('widgets', 'DecisionButtons.jsx'),
                read('widgets', 'Hints.jsx'),
                read('widgets', 'ViewAndContinueButtons.jsx'),
                read('chat', 'ContinueWidgetBubble.jsx'),
            ];
            for (const source of widgets) {
                expect(source).toMatch(/<span lang=\{\w+\.lang\}><i>\{\w+\.localized\}<\/i><\/span>/);
            }
        });

        it('MicStatusText localized text still relies on the global rule (no scoped override)', () => {
            const source = read('widgets', 'MicStatusText.jsx');
            expect(source).toContain('<span lang={bilingual.lang}>{bilingual.localized}</span>');
        });
    });
});
