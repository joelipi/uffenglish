import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { get } from '../../data/strings.js';
import LandscapeWarningNative from './LandscapeWarning.native.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...segments) => readFileSync(path.join(__dirname, ...segments), 'utf8');

const COMPONENT = read('LandscapeWarning.web.jsx');
const NATIVE = read('LandscapeWarning.native.jsx');
const LESSON_CONTAINER = read('..', 'LessonContainer.jsx');
const APP_CSS = read('..', '..', 'assets', 'css', 'app.css');

const DEVANAGARI = /[\u0900-\u097F]/;
const BENGALI = /[\u0980-\u09FF]/;

const blockFor = (source, selector) => {
    const start = source.indexOf(`${selector} {`);
    if (start === -1) return '';
    const end = source.indexOf('}', start);
    return source.slice(start, end + 1);
};

describe('LandscapeWarning.web.jsx wiring', () => {
    it('imports and calls the shared orientation predicates', () => {
        expect(COMPONENT).toMatch(/import\s*\{[^}]*shouldWarnLandscape[^}]*\}\s*from\s*['"].*orientation\.js['"]/);
        expect(COMPONENT).toContain('isLandscape(');
        expect(COMPONENT).toContain('isMobileUserAgent(');
        expect(COMPONENT).toContain('shouldWarnLandscape(');
    });

    it('reads the viewport from window.innerWidth / window.innerHeight', () => {
        expect(COMPONENT).toContain('window.innerWidth');
        expect(COMPONENT).toContain('window.innerHeight');
    });

    it('subscribes to and cleans up resize + orientationchange', () => {
        expect(COMPONENT).toContain("window.addEventListener('resize'");
        expect(COMPONENT).toContain("window.addEventListener('orientationchange'");
        expect(COMPONENT).toContain("window.removeEventListener('resize'");
        expect(COMPONENT).toContain("window.removeEventListener('orientationchange'");
    });

    it('gates the alert on shouldWarnLandscape and the dismissed flag', () => {
        expect(COMPONENT).toMatch(/shouldWarnLandscape\([^)]*\)\s*&&\s*!dismissed/);
        expect(COMPONENT).toContain('id="landscape-warning"');
        expect(COMPONENT).toContain('role="alert"');
    });

    it('renders the message via Strings.get("rotate_device_portrait")', () => {
        expect(COMPONENT).toContain("Strings.get('rotate_device_portrait'");
    });

    it('renders a dismiss button that sets dismissed to true', () => {
        expect(COMPONENT).toContain('id="landscape-warning-dismiss"');
        expect(COMPONENT).toContain('setDismissed(true)');
    });

    it('clears the dismissal when the viewport is no longer landscape', () => {
        expect(COMPONENT).toContain('if (!next.landscape)');
        expect(COMPONENT).toContain('setDismissed(false)');
    });
});

describe('LandscapeWarning.native.jsx stub', () => {
    it('returns null', () => {
        expect(NATIVE).toContain('return null');
        expect(LandscapeWarningNative()).toBeNull();
    });
});

describe('LessonContainer mounts the warning', () => {
    it('imports and renders <LandscapeWarning />', () => {
        expect(LESSON_CONTAINER).toContain("import LandscapeWarning from './widgets/LandscapeWarning'");
        expect(LESSON_CONTAINER).toContain('<LandscapeWarning />');
    });
});

describe('landscape warning styles', () => {
    it('fixes the banner above the lesson overlays', () => {
        const block = blockFor(APP_CSS, '.landscape-warning');
        expect(block).not.toBe('');
        expect(block).toMatch(/position:\s*fixed/);
        const zIndex = Number(block.match(/z-index:\s*(\d+)/)?.[1]);
        expect(Number.isFinite(zIndex)).toBe(true);
        expect(zIndex).toBeGreaterThan(1050);
    });

    it('styles the text and dismiss control', () => {
        expect(blockFor(APP_CSS, '.landscape-warning-text')).not.toBe('');
        expect(blockFor(APP_CSS, '.landscape-warning-dismiss')).not.toBe('');
    });
});

describe('landscape warning strings', () => {
    it('warns that landscape recording affects the video, in English', () => {
        const en = get('rotate_device_portrait', 'en');
        expect(en.toLowerCase()).toContain('landscape');
        expect(en.toLowerCase()).toContain('portrait');
        expect(en.toLowerCase()).toContain('video');
        expect(en.toLowerCase()).toMatch(/mess|affect|spoil|ruin|wreck/);
    });

    it('carries Devanagari hi and Bengali bn copy for both keys', () => {
        expect(get('rotate_device_portrait', 'hi')).toMatch(DEVANAGARI);
        expect(get('rotate_device_portrait', 'bn')).toMatch(BENGALI);
        expect(get('dismiss', 'hi')).toMatch(DEVANAGARI);
        expect(get('dismiss', 'bn')).toMatch(BENGALI);
    });
});
