import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Static guard for the public homepage's marketing sections + carousel wiring.
// The components pull in the router/asset graph, so this locks the wiring by raw
// source. Every slice is scoped to a specific block (AGENTS.md) — never whole-file
// for a property that could match more than one place — and asserts on raw source.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const homeLanding = read('./HomeLanding.jsx');
const container = read('./HomeLandingContainer.jsx');
const carousel = read('./ConversationCarousel.jsx');
const showcaseVideos = read('../../modules/video/showcase-videos.js');
const homeLandingCss = read('./home-landing.css');
const scopedBootstrap = read('../../generated/homepage-bootstrap.css');

describe('HomeLanding app-matched styling + scroll contract', () => {
    it('reuses the app brand gradient token', () => {
        expect(homeLandingCss).toContain('linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)');
    });

    it('applies the main app palette through the Bootstrap theme variables', () => {
        expect(homeLandingCss).toContain('--bs-body-bg: #0b1a2a');
        expect(homeLandingCss).toContain('--bs-card-bg: #1a3a5a');
        expect(homeLandingCss).toContain('--bs-border-color: #2a4a6a');
        expect(homeLandingCss).toContain('--bs-secondary-color: #adb5bd');
    });

    it('lifts the 9:16 phone frame on desktop for this page only', () => {
        const at = homeLandingCss.indexOf('#root:has(> .uff-home-bs)');
        expect(at).toBeGreaterThan(-1);
        const block = homeLandingCss.slice(at, homeLandingCss.indexOf('}', at));
        for (const prop of ['aspect-ratio', 'width', 'height', 'border-radius', 'max-width']) {
            expect(block, prop).toContain(prop);
        }
    });

    it('preserves every existing share-code testid', () => {
        for (const testid of ['share-code-input', 'share-code-go', 'share-code-error', 'no-code', 'landing-account-link']) {
            expect(homeLanding, testid).toContain(`data-testid="${testid}"`);
        }
    });

    it('stays opaque (never adds the lesson water surface)', () => {
        expect(homeLanding).not.toContain('water-surface');
        expect(homeLandingCss).not.toContain('water-surface');
    });

    it('renders the no-code action as a real type="button" button', () => {
        const at = homeLanding.indexOf('data-testid="no-code"');
        const from = homeLanding.lastIndexOf('<button', at);
        expect(at).toBeGreaterThan(-1);
        expect(from).toBeGreaterThan(-1);
        expect(homeLanding.slice(from, at)).toContain('type="button"');
    });

    it('keeps the Go action a type="submit" button', () => {
        const at = homeLanding.indexOf('data-testid="share-code-go"');
        const from = homeLanding.lastIndexOf('<button', at);
        expect(at).toBeGreaterThan(-1);
        expect(from).toBeGreaterThan(-1);
        expect(homeLanding.slice(from, at)).toContain('type="submit"');
    });

    it('styles the Go button white like the app call buttons, never gradient', () => {
        const at = homeLandingCss.indexOf('.uff-home-bs .btn-uff-primary {');
        expect(at).toBeGreaterThan(-1);
        const block = homeLandingCss.slice(at, homeLandingCss.indexOf('}', at));
        expect(block).toContain('#ffffff');
        expect(block).not.toContain('linear-gradient');
    });

    it('keeps the top-bar sign-in on a white solid button', () => {
        const at = homeLanding.indexOf('data-testid="landing-account-link"');
        expect(at).toBeGreaterThan(-1);
        const tagEnd = homeLanding.indexOf('>', at);
        expect(tagEnd).toBeGreaterThan(at);
        expect(homeLanding.slice(at, tagEnd)).toContain('btn-uff-topbar');
        const cssAt = homeLandingCss.indexOf('.uff-home-bs .btn-uff-topbar {');
        expect(cssAt).toBeGreaterThan(-1);
        const block = homeLandingCss.slice(cssAt, homeLandingCss.indexOf('}', cssAt));
        expect(block).toContain('#ffffff');
        expect(block).toContain('#0b1a2a');
    });

    it('sizes showcase media portrait 9:16 and caps it for desktop', () => {
        const at = homeLandingCss.indexOf('.uff-carousel-media {');
        expect(at).toBeGreaterThan(-1);
        const block = homeLandingCss.slice(at, homeLandingCss.indexOf('}', at));
        expect(block).toContain('9 / 16');
        expect(block).toContain('max-width');
        expect(block).toContain('39.375vh');
        expect(block).not.toContain('max-height:');
        expect(block).not.toContain('16 / 10');
    });

    it('caps the showcase card so the desktop block stays compact', () => {
        const at = homeLandingCss.indexOf('.uff-showcase-card {');
        expect(at).toBeGreaterThan(-1);
        const block = homeLandingCss.slice(at, homeLandingCss.indexOf('}', at));
        expect(block).toContain('max-width');
        expect(carousel).toContain('uff-showcase-card');
    });
});

describe('Bootstrap 5.3.8 is scoped to the homepage', () => {
    it('imports the scoped stylesheet and the homepage palette from HomeLanding', () => {
        expect(homeLanding).toContain("import '../../generated/homepage-bootstrap.css'");
        expect(homeLanding).toContain("import './home-landing.css'");
    });

    it('renders exactly one scoped homepage root', () => {
        // The scope class appears once in the source: the outermost wrapper.
        // Any extra occurrence (a comment, a second element) would leak.
        expect(homeLanding.split('uff-home-bs').length - 1).toBe(1);
        expect(homeLanding).toContain('className="uff-home-bs"');
    });

    it('no other file under src imports un-scoped Bootstrap or the scoped sheet', () => {
        // Repo-wide guard: real Bootstrap CSS is loaded only through the
        // homepage's scoped copy, never straight from node_modules.
        const UN_SCOPED_IMPORT = /import\s+['"]bootstrap\//;
        const SRC = path.join(__dirname, '../../..', 'src');
        const files = [];
        const walk = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                // Guards themselves assert on source; only app modules count.
                else if (/\.(js|jsx|css)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
            }
        };
        walk(SRC);
        const read2 = (f) => readFileSync(f, 'utf8');
        const offenders = files.filter((f) => UN_SCOPED_IMPORT.test(read2(f)));
        expect(offenders.map((f) => path.relative(SRC, f)).sort()).toEqual([]);

        // Only the homepage imports Bootstrap, and only through the scoped copy.
        const SCOPED_IMPORT = "import '../../generated/homepage-bootstrap.css'";
        const importers = files.filter((f) => read2(f).includes(SCOPED_IMPORT));
        expect(importers.map((f) => path.relative(SRC, f)).sort())
            .toEqual(['components/homescreen/HomeLanding.jsx']);
    });

    it('keeps the generated Bootstrap sheet scoped and root-free', () => {
        expect(scopedBootstrap.startsWith('.uff-home-bs,')).toBe(true);
        expect(scopedBootstrap).toContain('.uff-home-bs .container');
        expect(scopedBootstrap).toContain('.uff-home-bs .btn');
        expect(scopedBootstrap).not.toContain('@charset');
        expect(scopedBootstrap).not.toContain('The Bootstrap Authors');
        expect(scopedBootstrap).not.toMatch(/(^|[},])\s*(html|body)\s*[,{]/);
        expect(scopedBootstrap).not.toMatch(/(^|[}=;])\s*:root\s*[,{]/);
    });
});

describe('HomeLanding teacher photo', () => {
    it('imports the teacher portrait asset', () => {
        expect(homeLanding).toContain("from '../../assets/img/teacherprofile.webp'");
    });

    it('hardcodes the teacher name as a module constant', () => {
        expect(homeLanding).toContain('Joe Walsh');
    });
});

describe('HomeLanding language selector', () => {
    it('imports HOME_LANGUAGES from the shared languages data', () => {
        expect(homeLanding).toContain("import { HOME_LANGUAGES } from '../../data/languages.js'");
    });

    it('renders a language selector wired to onLanguageChange', () => {
        expect(homeLanding).toContain('data-testid="landing-language-select"');
        expect(homeLanding).toContain('onLanguageChange');
    });
});

describe('HomeLandingContainer language + carousel wiring', () => {
    it('routes the selector through setGuestLanguageSilent', () => {
        expect(container).toContain('setGuestLanguageSilent(');
        expect(container).toContain('onLanguageChange');
    });

    it('builds the showcase list from buildShowcaseVideos', () => {
        expect(container).toContain('buildShowcaseVideos(');
    });
});

describe('showcase-videos module', () => {
    it('resolves URLs through the shared video-url builders', () => {
        expect(showcaseVideos).toContain('getVideoUrl');
        expect(showcaseVideos).toContain('getPosterUrl');
        expect(showcaseVideos).toContain("from './video-url.js'");
    });
});

describe('ConversationCarousel poster-first contract', () => {
    it('renders the carousel section', () => {
        expect(carousel).toContain('data-testid="showcase-carousel"');
    });

    it('mounts the video element only inside the play branch', () => {
        const playAt = carousel.indexOf('playingSlug === v.slug');
        const videoAt = carousel.indexOf('<video');
        expect(playAt).toBeGreaterThan(-1);
        expect(videoAt).toBeGreaterThan(-1);
        expect(videoAt).toBeGreaterThan(playAt);
        expect((carousel.match(/<video/g) || []).length).toBe(1);
    });

    it('stays opaque (never adds the lesson water surface)', () => {
        expect(carousel).not.toContain('water-surface');
    });
});
